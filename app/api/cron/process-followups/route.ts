import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { renderOutreachEmail, sendBlockedReason } from "@/lib/email-templates";
import { logStatusChange } from "@/lib/audit";
import { rejectionReason } from "@/lib/email-validation";
import { DAILY_SEND_CAP } from "@/lib/automation";
import { phoenixDayStartIso } from "@/lib/lead-stats";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 120;

// Task lifecycle values below ('pending' | 'completed' | 'skipped' | 'cancelled')
// are constrained by follow_up_tasks_status_check — see
// supabase/migrations/007_follow_up_tasks_skipped.sql, which adds 'skipped'.
// This column is the TASK's state, not the lead's pipeline status; skipping a
// task deliberately leaves `leads.status` alone so the lead stays in the queue.

// GET is what Vercel Cron sends. A bad or missing secret returns 401 — never a
// 200.
//
// There used to be an unauthenticated "health check" 200 here. It actively hid
// a real outage: the cron-job.org schedule pointed here held a stale secret and
// received a cheerful 200 body while sending zero follow-ups, so the job read
// green for as long as it was broken. A wrong secret must fail loudly.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return POST(req);
}

export async function POST(req: NextRequest) {
  // Verify cron secret (required for security)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET not set - cron jobs disabled for security");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("🔁 Starting follow-up task processing...");

    const nowIso = new Date().toISOString();

    // Get all due, pending follow-up tasks
    const { data: tasks, error: tasksError } = await supabase
      .from("follow_up_tasks")
      .select("id, lead_id, task_type, due_at, status")
      .eq("status", "pending")
      .lte("due_at", nowIso)
      .order("due_at", { ascending: true });

    if (tasksError) {
      console.error("Failed to load follow-up tasks:", tasksError);
      throw tasksError;
    }

    if (!tasks || tasks.length === 0) {
      console.log("No due follow-up tasks");
      return NextResponse.json({
        success: true,
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: [],
        message: "No due follow-up tasks",
      });
    }

    console.log(`Found ${tasks.length} due follow-up task(s)`);

    const results = {
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: [] as Array<{ taskId: string; leadId: string | null; error: string }>,
    };

    const blocked = sendBlockedReason();
    if (blocked) {
      console.error(blocked);
      return NextResponse.json({ success: false, sent: 0, blocked }, { status: 409 });
    }

    // Follow-ups share the same Phoenix-day cap as initial outreach. Count from
    // the database and fail closed so a weekly backlog can never burst past the
    // sender-reputation limit.
    const { count: sentToday, error: countError } = await supabase
      .from("outreach_log")
      .select("id", { count: "exact", head: true })
      .eq("channel", "email")
      .eq("direction", "outbound")
      .gte("sent_at", phoenixDayStartIso());
    if (countError) {
      return NextResponse.json(
        { success: false, sent: 0, error: `Daily send-cap lookup failed: ${countError.message}` },
        { status: 500 }
      );
    }
    const remainingToday = DAILY_SEND_CAP - (sentToday || 0);
    if (remainingToday <= 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: [],
        cappedAt: DAILY_SEND_CAP,
        message: `Daily send cap (${DAILY_SEND_CAP}) already reached; due tasks remain pending`,
      });
    }

    for (const task of tasks) {
      if (results.sent >= remainingToday) break;
      results.processed++;

      try {
        // a. Look up the related lead
        const { data: lead, error: leadError } = await supabase
          .from("leads")
          .select(
            `id, business_name, owner_name, email, status, opt_out, bounced, complained, archived_at, email_sent_count,
            lead_ai_summaries(recommended_first_message, recommended_follow_up, main_pain_point, lead_score)`
          )
          .eq("id", task.lead_id)
          .single();

        if (leadError || !lead) {
          throw new Error(leadError?.message || "Lead not found");
        }

        // Only an active lead still inside the cold-email sequence can receive
        // a queued follow-up. This protects against stale tasks after replies,
        // bookings, bounces, complaints, suppression, or archival.
        const followUpStatuses = new Set(["Email 1 Sent", "Email 2 Sent", "Follow-Up Scheduled"]);
        if (
          !followUpStatuses.has(lead.status) ||
          lead.opt_out === true ||
          lead.bounced === true ||
          lead.complained === true ||
          Boolean(lead.archived_at)
        ) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "skipped",
              notes: `Skipped: lead is no longer eligible for cold follow-up (status ${lead.status})`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", task.id);

          console.log(`Skipped ${lead.business_name}: no longer follow-up eligible`);
          results.skipped++;
          continue;
        }

        // No email address — nothing to send
        if (!lead.email) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "skipped",
              notes: "Skipped: lead has no email address",
              completed_at: new Date().toISOString(),
            })
            .eq("id", task.id);

          console.log(`Skipped ${lead.business_name}: no email address`);
          results.skipped++;
          continue;
        }

        const summary = Array.isArray(lead.lead_ai_summaries)
          ? lead.lead_ai_summaries[0]
          : lead.lead_ai_summaries;

        const emailNum = (lead.email_sent_count || 0) + 1;

        if (task.task_type !== `send_email_${emailNum}`) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "skipped",
              notes: `Skipped stale task: expected send_email_${emailNum}, got ${task.task_type}`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", task.id);
          results.skipped++;
          continue;
        }

        // Already sent the full 3-email sequence — nothing left to send
        if (emailNum > 3) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "skipped",
              notes: "Skipped: max emails (3) already sent",
              completed_at: new Date().toISOString(),
            })
            .eq("id", task.id);

          console.log(`Skipped ${lead.business_name}: max emails reached`);
          results.skipped++;
          continue;
        }

        const badAddress = await rejectionReason(lead.email);
        if (badAddress) {
          const { error: badLeadError } = await supabase
            .from("leads")
            .update({ status: "Bad Email", updated_at: new Date().toISOString() })
            .eq("id", lead.id);
          if (badLeadError) throw new Error(`Bad-email lead update failed: ${badLeadError.message}`);
          const { error: badTaskError } = await supabase
            .from("follow_up_tasks")
            .update({ status: "skipped", notes: `Skipped: ${badAddress}`, completed_at: new Date().toISOString() })
            .eq("id", task.id);
          if (badTaskError) throw new Error(`Bad-email task update failed: ${badTaskError.message}`);
          await logStatusChange({ leadId: lead.id, from: lead.status, to: "Bad Email", source: "automation", reason: badAddress });
          results.skipped++;
          continue;
        }

        // c. Build the email via the shared renderer (subject + body + footer)
        const { subject, html, bodyText } = renderOutreachEmail({
          leadId: lead.id,
          businessName: lead.business_name,
          ownerName: (lead as any).owner_name,
          emailSentCount: lead.email_sent_count || 0,
          firstMessage: summary?.recommended_first_message,
          followUp: summary?.recommended_follow_up,
        });

        console.log(`Sending follow-up email ${emailNum} to ${lead.business_name}...`);
        const sendResult = await sendEmail(
          lead.email,
          subject,
          html,
          undefined,
          `crm-${lead.id}-email-${emailNum}`
        );

        // d. Log the send to outreach_log
        const { data: existingLog, error: existingLogError } = await supabase
          .from("outreach_log").select("id").eq("provider_message_id", sendResult.id).maybeSingle();
        if (existingLogError) throw new Error(`Sent email but log lookup failed: ${existingLogError.message}`);
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
            provider_message_id: sendResult.id,
            sent_at: new Date().toISOString(),
          });
          if (logError) throw new Error(`Sent email but failed to log it: ${logError.message}`);
        }

        // e. Update the lead's email_sent_count and status
        const newStatus = emailNum === 1 ? "Email 1 Sent" : emailNum === 2 ? "Email 2 Sent" : "Email 3 Sent";

        const { data: updatedLead, error: leadUpdateError } = await supabase
          .from("leads")
          .update({
            email_sent_count: emailNum,
            status: newStatus,
          })
          .eq("id", lead.id)
          .select("id")
          .single();
        if (leadUpdateError || !updatedLead) {
          throw new Error(leadUpdateError?.message || "Sent email but lead update changed no rows");
        }

        await logStatusChange({ leadId: lead.id, from: lead.status ?? null, to: newStatus, source: "automation" });

        // f. Mark this task completed
        const { data: completedTask, error: completeError } = await supabase
          .from("follow_up_tasks")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id)
          .select("id")
          .single();
        if (completeError || !completedTask) {
          throw new Error(completeError?.message || "Follow-up task completion changed no rows");
        }

        // Auto-schedule the next email (mirrors send-daily/route.ts)
        if (emailNum < 3) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 3);
          dueDate.setHours(9, 0, 0, 0);

          const { error: nextTaskError } = await supabase.from("follow_up_tasks").insert({
            lead_id: lead.id,
            task_type: `send_email_${emailNum + 1}`,
            due_at: dueDate.toISOString(),
            status: "pending",
          });
          if (nextTaskError) throw new Error(`Next follow-up scheduling failed: ${nextTaskError.message}`);
        }

        console.log(`✅ Sent follow-up email ${emailNum} to ${lead.business_name}`);
        results.sent++;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to process task ${task.id}:`, errMsg);
        results.errors.push({ taskId: task.id, leadId: task.lead_id, error: errMsg });
      }
    }

    console.log(
      `✅ Follow-up processing complete: ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} error(s)`
    );

    const payload = {
      success: results.errors.length === 0,
      processed: results.processed,
      sent: results.sent,
      skipped: results.skipped,
      errors: results.errors,
      message: `Processed ${results.processed} task(s): ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} error(s)`,
    };
    return NextResponse.json(payload, { status: results.errors.length === 0 ? 200 : 500 });
  } catch (error) {
    console.error("Follow-up processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Follow-up processing failed" },
      { status: 500 }
    );
  }
}
