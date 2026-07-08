import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { renderOutreachEmail } from "@/lib/email-templates";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const DAY_IN_MS = 24 * 60 * 60 * 1000;

    // Check daily cap
    const { data: sentToday } = await supabase
      .from("outreach_log")
      .select("id")
      .eq("channel", "email")
      .gte("sent_at", `${today}T00:00:00Z`);

    const sentCount = sentToday?.length || 0;
    if (sentCount >= 25) {
      return NextResponse.json({ error: "Daily limit reached", sent: 0 });
    }

    const remaining = 25 - sentCount;

    // Get ready leads with score > 50
    const { data: leadsWithScores } = await supabase
      .from("leads")
      .select(
        `id, business_name, email, status, email_sent_count,
        lead_ai_summaries(lead_score, recommended_first_message, recommended_follow_up, main_pain_point, best_attack_angle)`
      )
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .in("status", ["Ready for Outreach", "Email 1 Sent", "Email 2 Sent"])
      .not("email", "is", null)
      .neq("email", "")
      .limit(remaining);

    // Filter by score > 50
    const leads = (leadsWithScores || []).filter(
      (l: any) => (l.lead_ai_summaries?.[0]?.lead_score || 0) > 50
    );

    const results = { sent: 0, failed: 0 };

    for (const lead of leads) {
      try {
        const summary = lead.lead_ai_summaries?.[0];
        const emailNum = (lead.email_sent_count || 0) + 1;

        if (emailNum > 3) continue;

        const { subject, html, bodyText } = renderOutreachEmail({
          businessName: lead.business_name,
          emailSentCount: lead.email_sent_count || 0,
          firstMessage: summary?.recommended_first_message,
          followUp: summary?.recommended_follow_up,
        });

        const sendResult = await sendEmail(lead.email, subject, html);

        await supabase.from("outreach_log").insert({
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

        const newStatus = emailNum === 1 ? "Email 1 Sent" : emailNum === 2 ? "Email 2 Sent" : "Email 3 Sent";

        await supabase
          .from("leads")
          .update({
            email_sent_count: emailNum,
            status: newStatus,
          })
          .eq("id", lead.id);

        await logStatusChange({ leadId: lead.id, from: lead.status ?? null, to: newStatus, source: "automation" });

        // Auto-schedule next email
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

        results.sent++;
      } catch (error) {
        console.error("Send error:", error);
        results.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      sent: results.sent,
      failed: results.failed,
      totalSent: results.sent,
      message: `✅ Daily send complete: ${results.sent} emails sent to leads with score > 50`,
    });
  } catch (error) {
    console.error("Daily send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Daily send failed" },
      { status: 500 }
    );
  }
}
