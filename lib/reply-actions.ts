import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { footerHtml } from "@/lib/email-templates";
import { logStatusChange } from "@/lib/audit";
import { bucketForCategory, type ReplyBucket } from "@/lib/reply-policy";

export { bucketForCategory } from "@/lib/reply-policy";
export type { ReplyBucket } from "@/lib/reply-policy";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Calendly is wired to the owner's Google Calendar, so this single link handles
// all scheduling + calendar-event creation. No custom free/busy code needed.
export const CALENDLY_LINK =
  "https://calendly.com/fullstackservicesllc/full-stack-meeting";

export async function cancelPendingColdEmailTasks(leadId: string, now = new Date().toISOString()): Promise<void> {
  const { error } = await supabase
    .from("follow_up_tasks")
    .update({
      status: "cancelled",
      completed_at: now,
      notes: "Cancelled automatically: prospect replied",
    })
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .like("task_type", "send_email_%");

  if (error) throw new Error(`Failed to cancel pending cold-email tasks: ${error.message}`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function bookingEmail(ownerName?: string | null, leadId?: string | null) {
  const firstName = ownerName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  return {
    subject: "Great, let us find a time to talk",
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p style="color:#333; line-height:1.6;">${greeting}</p>
  <p style="color:#333; line-height:1.6;">Thanks for getting back to us. We are glad you are interested. The easiest next step is to choose a time that works for you. Pick any open slot below and it will appear on both calendars.</p>
  <p style="text-align:center; margin:28px 0;">
    <a href="${CALENDLY_LINK}" style="background:#2563eb; color:#fff; text-decoration:none; padding:12px 24px; border-radius:8px; font-weight:600; display:inline-block;">Book a time →</a>
  </p>
  <p style="color:#666; line-height:1.6; font-size:14px;">Or copy this link into your browser: <a href="${CALENDLY_LINK}">${CALENDLY_LINK}</a></p>
  <p style="color:#333; line-height:1.6;">Looking forward to it.</p>
  ${footerHtml(leadId)}
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
 *   unclear        → status "Needs Follow-Up" for human review
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
    .select("id, business_name, owner_name, email, status, opt_out, calendly_link_sent")
    .eq("id", leadId)
    .single();

  if (error || !lead) {
    throw new Error(`Lead not found for id ${leadId}: ${error?.message || "no row"}`);
  }

  if (lead.opt_out || lead.status === "Do Not Contact") {
    await cancelPendingColdEmailTasks(leadId, now);
    return {
      bucket,
      category,
      action: "suppressed_no_contact",
      emailSent: false,
      leadStatus: "Do Not Contact",
      sentTo: lead.email || undefined,
    };
  }

  // A reply always ends the automated cold sequence. This happens before any
  // classification-specific action so a positive, negative, wrong-person, or
  // unclear reply can never receive a queued touch 2/3 afterward.
  await cancelPendingColdEmailTasks(leadId, now);

  if (bucket === "interested") {
    // Idempotency guard: a retry after an external send or status-write failure
    // must not send a second booking email to the same prospect.
    if (lead.calendly_link_sent) {
      return {
        bucket,
        category,
        action: "booking_link_already_sent",
        emailSent: false,
        leadStatus: lead.status || "Booking Link Sent",
        sentTo: lead.email || undefined,
      };
    }
    if (!lead.email) {
      const { error: updateError } = await supabase
        .from("leads")
        .update({ status: "Booking Link Sent", updated_at: now })
        .eq("id", leadId);
      if (updateError) throw new Error(`Failed to update interested lead: ${updateError.message}`);
      await logStatusChange({ leadId, from: lead.status, to: "Booking Link Sent", source: "automation" });
      return {
        bucket,
        category,
        action: "interested_no_email",
        emailSent: false,
        leadStatus: "Booking Link Sent",
      };
    }

    const { subject, html } = bookingEmail(lead.owner_name, leadId);
    const sendResult = await sendEmail(
      lead.email,
      subject,
      html,
      undefined,
      `crm-${lead.id}-booking-link`
    );

    const { error: updateError } = await supabase
      .from("leads")
      .update({
        status: "Booking Link Sent",
        calendly_link_sent: true,
        updated_at: now,
      })
      .eq("id", leadId);
    if (updateError) throw new Error(`Failed to update interested lead: ${updateError.message}`);

    const { error: logError } = await supabase.from("outreach_log").insert({
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
    if (logError) throw new Error(`Booking link sent but outreach log failed: ${logError.message}`);

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
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        status: "Do Not Contact",
        opt_out: true,
        // Preserve where the lead was before we suppressed it (first time only).
        ...(lead.opt_out ? {} : { status_before_suppression: lead.status || null }),
        updated_at: now,
      })
      .eq("id", leadId);
    if (updateError) throw new Error(`Failed to suppress replied lead: ${updateError.message}`);
    await logStatusChange({ leadId, from: lead.status, to: "Do Not Contact", source: "automation" });
    return {
      bucket,
      category,
      action: "marked_do_not_contact",
      emailSent: false,
      leadStatus: "Do Not Contact",
    };
  }

  // Unclear, Too Busy, Question, Wrong Person, or an unknown category requires
  // human review. Do not enqueue it in follow_up_tasks: that table is consumed
  // by the automatic email sender and could restart cold outreach after reply.
  const { error: updateError } = await supabase
    .from("leads")
    .update({ status: "Needs Follow-Up", next_follow_up_at: now, updated_at: now })
    .eq("id", leadId);
  if (updateError) throw new Error(`Failed to queue reply for human review: ${updateError.message}`);
  await logStatusChange({ leadId, from: lead.status, to: "Needs Follow-Up", source: "automation" });

  return {
    bucket,
    category,
    action: "human_review_required",
    emailSent: false,
    leadStatus: "Needs Follow-Up",
  };
}
