import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { footerHtml } from "@/lib/email-templates";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Calendly is wired to the owner's Google Calendar, so this single link handles
// all scheduling + calendar-event creation. No custom free/busy code needed.
export const CALENDLY_LINK =
  "https://calendly.com/fullstackservicesllc/full-stack-meeting";

export type ReplyBucket = "interested" | "not_interested" | "unclear";

// Grok/Together classifier categories → the three outcomes we automate.
const POSITIVE = new Set(["Interested", "Asked Price", "Send Info"]);
const NEGATIVE = new Set(["Not Interested", "Wrong Person", "Stop"]);

export function bucketForCategory(category: string): ReplyBucket {
  if (POSITIVE.has(category)) return "interested";
  if (NEGATIVE.has(category)) return "not_interested";
  return "unclear"; // Too Busy, Question, or anything unrecognized
}

function bookingEmail(company?: string | null) {
  const name = company?.trim() ? ` at ${company.trim()}` : "";
  return {
    subject: "Great — let's find a time to talk",
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p style="color:#333; line-height:1.6;">Hi there,</p>
  <p style="color:#333; line-height:1.6;">Thanks for getting back to us${name} — glad you're interested! The easiest next step is to grab whatever time works best for you. Pick any open slot on the link below and it'll drop straight onto both our calendars:</p>
  <p style="text-align:center; margin:28px 0;">
    <a href="${CALENDLY_LINK}" style="background:#2563eb; color:#fff; text-decoration:none; padding:12px 24px; border-radius:8px; font-weight:600; display:inline-block;">Book a time →</a>
  </p>
  <p style="color:#666; line-height:1.6; font-size:14px;">Or copy this link into your browser: <a href="${CALENDLY_LINK}">${CALENDLY_LINK}</a></p>
  <p style="color:#333; line-height:1.6;">Looking forward to it.</p>
  ${footerHtml()}
</div>`,
  };
}

export interface ReplyActionResult {
  bucket: ReplyBucket;
  category: string;
  action: string;
  emailSent: boolean;
  messageId?: string;
  leadStatus: string;
  sentTo?: string;
}

/**
 * Acts on a classified reply:
 *   interested     → send the Calendly booking-link email + status "Booking Link Sent"
 *   not_interested → status "Do Not Contact" + opt_out
 *   unclear        → status "Needs Follow-Up" + schedule a follow-up task
 *
 * Operates on the `leads` table (the booking pipeline and email queues read from
 * there; the `booking_tracker` table is empty/unused per app/api/crm/bookings).
 */
export async function actOnReplyClassification(
  leadId: string,
  category: string
): Promise<ReplyActionResult> {
  const bucket = bucketForCategory(category);
  const now = new Date().toISOString();

  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, business_name, email, status, opt_out")
    .eq("id", leadId)
    .single();

  if (error || !lead) {
    throw new Error(`Lead not found for id ${leadId}: ${error?.message || "no row"}`);
  }

  if (bucket === "interested") {
    if (!lead.email) {
      await supabase
        .from("leads")
        .update({ status: "Booking Link Sent", updated_at: now })
        .eq("id", leadId);
      await logStatusChange({ leadId, from: lead.status, to: "Booking Link Sent", source: "automation" });
      return {
        bucket,
        category,
        action: "interested_no_email",
        emailSent: false,
        leadStatus: "Booking Link Sent",
      };
    }

    const { subject, html } = bookingEmail(lead.business_name);
    const sendResult = await sendEmail(lead.email, subject, html);

    await supabase
      .from("leads")
      .update({
        status: "Booking Link Sent",
        calendly_link_sent: true,
        updated_at: now,
      })
      .eq("id", leadId);

    await supabase.from("outreach_log").insert({
      lead_id: leadId,
      channel: "email",
      direction: "outbound",
      message_type: "booking_link",
      subject,
      message_body: `Calendly booking link sent: ${CALENDLY_LINK}`,
      status: "sent",
      provider: "resend",
      provider_message_id: sendResult?.id,
      sent_at: now,
    });

    await logStatusChange({ leadId, from: lead.status, to: "Booking Link Sent", source: "automation" });

    return {
      bucket,
      category,
      action: "booking_link_sent",
      emailSent: true,
      messageId: sendResult?.id,
      leadStatus: "Booking Link Sent",
      sentTo: lead.email,
    };
  }

  if (bucket === "not_interested") {
    await supabase
      .from("leads")
      .update({
        status: "Do Not Contact",
        opt_out: true,
        // Preserve where the lead was before we suppressed it (first time only).
        ...(lead.opt_out ? {} : { status_before_suppression: lead.status || null }),
        updated_at: now,
      })
      .eq("id", leadId);
    await logStatusChange({ leadId, from: lead.status, to: "Do Not Contact", source: "automation" });
    return {
      bucket,
      category,
      action: "marked_do_not_contact",
      emailSent: false,
      leadStatus: "Do Not Contact",
    };
  }

  // unclear → set a follow-up on the lead and enqueue a task for the cron.
  const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from("leads")
    .update({ status: "Needs Follow-Up", next_follow_up_at: dueAt, updated_at: now })
    .eq("id", leadId);
  await logStatusChange({ leadId, from: lead.status, to: "Needs Follow-Up", source: "automation" });

  const { error: taskError } = await supabase.from("follow_up_tasks").insert({
    lead_id: leadId,
    task_type: "reply_followup",
    due_at: dueAt,
    status: "pending",
  });
  if (taskError) {
    // Non-fatal: the lead already carries next_follow_up_at as a backstop.
    console.warn("follow_up_tasks insert failed (non-fatal):", taskError.message);
  }

  return {
    bucket,
    category,
    action: "follow_up_scheduled",
    emailSent: false,
    leadStatus: "Needs Follow-Up",
  };
}
