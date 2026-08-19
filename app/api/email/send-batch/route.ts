import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { renderEditedOutreachEmail, renderOutreachEmail, sendBlockedReason } from "@/lib/email-templates";
import { logStatusChange } from "@/lib/audit";
import { rejectionReason } from "@/lib/email-validation";
import { phoenixDayStartIso } from "@/lib/lead-stats";
import { MANUAL_SEND_CAP, nextFollowUpAt } from "@/lib/email-sequence";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
    if (!leadId) {
      return NextResponse.json(
        { error: "A leadId is required; bulk sending is not available from this endpoint" },
        { status: 400 }
      );
    }

    // Use the same Phoenix-day, database-backed cap as scheduled automation.
    const { count: sentCount, error: countError } = await supabase
      .from("outreach_log")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "outbound")
      .gte("sent_at", phoenixDayStartIso());
    if (countError) throw new Error(`Daily send-cap lookup failed: ${countError.message}`);

    const emailsSentToday = sentCount || 0;
    if (emailsSentToday >= MANUAL_SEND_CAP) {
      return NextResponse.json(
        { error: `Manual daily limit (${MANUAL_SEND_CAP}) reached`, totalSent: 0 },
        { status: 429 }
      );
    }

    // This route backs the selected lead's Email tab. It must never silently
    // expand into a batch or mail a replied/booked/suppressed lead.
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, business_name, email, owner_name, status, industry, niche, email_sent_count, next_follow_up_at, lead_ai_summaries!inner(lead_score)")
      .eq("id", leadId)
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .is("archived_at", null)
      .gt("lead_ai_summaries.lead_score", 50)
      .in("status", ["Ready for Outreach", "Email 1 Sent", "Email 2 Sent", "Follow-Up Scheduled"])
      .maybeSingle();

    if (error) throw new Error(`Lead eligibility lookup failed: ${error.message}`);
    if (!lead) {
      return NextResponse.json(
        { error: "This lead is not eligible to email. Check its score, status, suppression flags, address, and sequence count." },
        { status: 409 }
      );
    }
    const market = `${lead.industry || lead.niche || ""}`.trim().toLowerCase();
    if (market !== "hvac") {
      return NextResponse.json(
        { error: "This outreach template is approved for HVAC leads only" },
        { status: 409 }
      );
    }

    const emailNum = (lead.email_sent_count || 0) + 1;
    const blocked = sendBlockedReason();
    if (blocked) {
      console.error(blocked);
      return NextResponse.json({ success: false, sent: 0, blocked }, { status: 409 });
    }

    const badAddress = await rejectionReason(lead.email);
    if (badAddress) {
      const { error: badEmailError } = await supabase
        .from("leads")
        .update({ status: "Bad Email", updated_at: new Date().toISOString() })
        .eq("id", lead.id);
      if (badEmailError) throw new Error(`Email rejected and lead update failed: ${badEmailError.message}`);
      await logStatusChange({ leadId: lead.id, from: lead.status, to: "Bad Email", source: "owner", reason: badAddress });
      return NextResponse.json({ error: `Email address rejected: ${badAddress}`, totalSent: 0 }, { status: 409 });
    }

    const approved = renderOutreachEmail({
      leadId: lead.id,
      businessName: lead.business_name,
      ownerName: lead.owner_name,
      emailSentCount: lead.email_sent_count || 0,
    });
    const requestedSubject = typeof body.subject === "string" ? body.subject.trim() : "";
    const requestedMessage = typeof body.messageText === "string" ? body.messageText.trim() : "";
    if ((requestedSubject && !requestedMessage) || (!requestedSubject && requestedMessage)) {
      return NextResponse.json({ error: "Both the subject and message are required when editing an email" }, { status: 400 });
    }
    if (requestedSubject.length > 160 || requestedMessage.length > 5000) {
      return NextResponse.json({ error: "The subject or message is too long" }, { status: 400 });
    }
    const rendered = requestedSubject && requestedMessage
      ? renderEditedOutreachEmail({ emailNum, subject: requestedSubject, messageText: requestedMessage, leadId: lead.id })
      : approved;
    const { subject, html, bodyText } = rendered;

    const result = await sendEmail(
      lead.email!,
      subject,
      html,
      undefined,
      `crm-${lead.id}-email-${emailNum}`
    );

    const { data: existingLog, error: existingLogError } = await supabase
      .from("outreach_log")
      .select("id")
      .eq("provider_message_id", result.id)
      .maybeSingle();
    if (existingLogError) throw new Error(`Email sent but log lookup failed: ${existingLogError.message}`);
    if (!existingLog) {
      const { error: logError } = await supabase.from("outreach_log").insert({
          lead_id: lead.id,
          channel: "email",
          direction: "outbound",
          message_type: `email_${emailNum}`,
          subject,
          message_body: bodyText,
          status: "sent",
          provider: "resend",
          provider_message_id: result.id,
          sent_at: new Date().toISOString(),
      });
      if (logError) throw new Error(`Email sent but outreach logging failed: ${logError.message}`);
    }

    const newStatus = `Email ${emailNum} Sent`;
    const nextFollowUp = emailNum < 3 ? nextFollowUpAt() : null;
    const { data: updatedLead, error: updateError } = await supabase
      .from("leads")
      .update({
        email_sent_count: emailNum,
        status: newStatus,
        next_follow_up_at: nextFollowUp,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id)
      .select("id")
      .single();
    if (updateError || !updatedLead) {
      throw new Error(updateError?.message || "Email sent but lead update changed no rows");
    }

    await logStatusChange({ leadId: lead.id, from: lead.status, to: newStatus, source: "owner" });

    if (emailNum > 1) {
      const { error: completedTaskError } = await supabase
        .from("follow_up_tasks")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          notes: "Sent manually from Email Workspace",
        })
        .eq("lead_id", lead.id)
        .eq("task_type", `send_email_${emailNum}`)
        .eq("status", "pending");
      if (completedTaskError) throw new Error(`Email sent but followup task cleanup failed: ${completedTaskError.message}`);
    }

    if (emailNum < 3) {
      const { data: existingTask, error: taskLookupError } = await supabase
        .from("follow_up_tasks")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("task_type", `send_email_${emailNum + 1}`)
        .eq("status", "pending")
        .maybeSingle();
      if (taskLookupError) throw new Error(`Email sent but follow-up lookup failed: ${taskLookupError.message}`);
      if (!existingTask) {
        const { error: taskError } = await supabase.from("follow_up_tasks").insert({
          lead_id: lead.id,
          task_type: `send_email_${emailNum + 1}`,
          due_at: nextFollowUp,
          status: "pending",
        });
        if (taskError) throw new Error(`Email sent but follow-up scheduling failed: ${taskError.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      totalSent: 1,
      leadId: lead.id,
      emailNum,
      status: newStatus,
      message: `Sent email ${emailNum} to ${lead.business_name} (${emailsSentToday + 1}/${MANUAL_SEND_CAP} today)`,
    });
  } catch (error) {
    console.error("Email error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
