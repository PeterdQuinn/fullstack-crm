import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 120;

// Health check — lets you open the URL in a browser and see JSON instead of a 405.
// This does NOT run the job or send any emails; the actual work is POST-only below.
export async function GET() {
  return NextResponse.json({
    status: "ok",
    route: "/api/cron/process-followups",
    method: "POST",
    auth: "Authorization: Bearer <CRON_SECRET>",
    note: "This endpoint runs on POST only. Trigger it from cron-job.org or curl, not a browser.",
    cron_secret_configured: Boolean(process.env.CRON_SECRET),
  });
}

// Same template logic as app/api/email/send-daily/route.ts
const EMAIL_TEMPLATES: Record<number, (company: string, message: string) => { subject: string; html: string }> = {
  1: (company, message) => ({
    subject: `Custom Solution for ${company} - Let's Chat`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi there,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
  2: (company, message) => ({
    subject: `Quick follow-up: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hey,</h2><p style="color: #666; line-height: 1.6;">Just following up.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
  3: (company, message) => ({
    subject: `Last chance: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi,</h2><p style="color: #666; line-height: 1.6;">Final message: ${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
};

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

    for (const task of tasks) {
      results.processed++;

      try {
        // a. Look up the related lead
        const { data: lead, error: leadError } = await supabase
          .from("leads")
          .select(
            `id, business_name, email, status, opt_out, email_sent_count,
            lead_ai_summaries(recommended_first_message, recommended_follow_up, main_pain_point, lead_score)`
          )
          .eq("id", task.lead_id)
          .single();

        if (leadError || !lead) {
          throw new Error(leadError?.message || "Lead not found");
        }

        // b. Skip Do Not Contact / opted-out leads
        if (lead.status === "Do Not Contact" || lead.opt_out === true) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "cancelled", // NOTE: schema CHECK has no 'skipped' value — see route header note
              notes: `Skipped: lead is ${lead.opt_out ? "opted out" : "Do Not Contact"}`,
              completed_at: new Date().toISOString(),
            })
            .eq("id", task.id);

          console.log(`Skipped ${lead.business_name}: ${lead.opt_out ? "opted out" : "Do Not Contact"}`);
          results.skipped++;
          continue;
        }

        // No email address — nothing to send
        if (!lead.email) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "cancelled",
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

        // Already sent the full 3-email sequence — nothing left to send
        if (emailNum > 3) {
          await supabase
            .from("follow_up_tasks")
            .update({
              status: "cancelled",
              notes: "Skipped: max emails (3) already sent",
              completed_at: new Date().toISOString(),
            })
            .eq("id", task.id);

          console.log(`Skipped ${lead.business_name}: max emails reached`);
          results.skipped++;
          continue;
        }

        // c. Build the message (same logic as send-daily/route.ts)
        let message = summary?.recommended_first_message || "";
        if (emailNum === 2) {
          message = summary?.recommended_follow_up || "";
        } else if (emailNum === 3) {
          message = summary?.recommended_follow_up || "";
        }

        const template = EMAIL_TEMPLATES[emailNum as keyof typeof EMAIL_TEMPLATES] || EMAIL_TEMPLATES[1];
        const { subject, html } = template(lead.business_name, message);

        console.log(`Sending follow-up email ${emailNum} to ${lead.business_name}...`);
        const sendResult = await sendEmail(lead.email, subject, html);

        // d. Log the send to outreach_log
        await supabase.from("outreach_log").insert({
          lead_id: lead.id,
          channel: "email",
          direction: "outbound",
          message_type: `email_${emailNum}`,
          subject,
          message_body: message,
          status: "sent",
          provider: "resend",
          provider_message_id: sendResult.id,
          sent_at: new Date().toISOString(),
        });

        // e. Update the lead's email_sent_count and status
        const newStatus = emailNum === 1 ? "Email 1 Sent" : emailNum === 2 ? "Email 2 Sent" : "Email 3 Sent";

        await supabase
          .from("leads")
          .update({
            email_sent_count: emailNum,
            status: newStatus,
          })
          .eq("id", lead.id);

        // f. Mark this task completed
        await supabase
          .from("follow_up_tasks")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", task.id);

        // Auto-schedule the next email (mirrors send-daily/route.ts)
        if (emailNum < 3) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 3);
          dueDate.setHours(9, 0, 0, 0);

          await supabase.from("follow_up_tasks").insert({
            lead_id: lead.id,
            task_type: `send_email_${emailNum + 1}`,
            due_at: dueDate.toISOString(),
            status: "pending",
          });
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

    return NextResponse.json({
      success: true,
      processed: results.processed,
      sent: results.sent,
      skipped: results.skipped,
      errors: results.errors,
      message: `Processed ${results.processed} task(s): ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} error(s)`,
    });
  } catch (error) {
    console.error("Follow-up processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Follow-up processing failed" },
      { status: 500 }
    );
  }
}
