import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { renderOutreachEmail } from "@/lib/email-templates";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 120;

export async function GET(req: NextRequest) {
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
    console.log("📧 Starting daily email send...");

    const today = new Date().toISOString().split("T")[0];

    // Check daily limit
    const { count: sentCount } = await supabase
      .from("outreach_log")
      .select("*", { count: "exact", head: true })
      .eq("channel", "email")
      .gte("sent_at", `${today}T00:00:00Z`);

    const emailsSentToday = sentCount || 0;
    if (emailsSentToday >= 25) {
      console.log(`Daily limit reached: ${emailsSentToday}/25`);
      return NextResponse.json({
        success: true,
        sent: 0,
        message: `Daily limit reached: ${emailsSentToday}/25 emails sent`,
      });
    }

    const remaining = 25 - emailsSentToday;

    // Get leads ready to email
    const { data: leads } = await supabase
      .from("leads")
      .select("id, business_name, email, email_sent_count, lead_ai_summaries(recommended_first_message, recommended_follow_up, main_pain_point, lead_score)")
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .in("status", ["Ready for Outreach", "Email 1 Sent", "Email 2 Sent"])
      .limit(remaining);

    if (!leads || leads.length === 0) {
      console.log("No leads ready to email");
      return NextResponse.json({
        success: true,
        sent: 0,
        message: "No leads ready to email",
      });
    }

    console.log(`Found ${leads.length} leads to email (${remaining} slots remaining)`);

    const results = { sent: [] as any[], failed: [] as any[] };

    for (const lead of leads) {
      try {
        const summary = Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] : lead.lead_ai_summaries;
        const score = summary?.lead_score || 0;

        // Only send if score is decent
        if (score < 40) {
          console.log(`Skipping ${lead.business_name}: score too low (${score})`);
          continue;
        }

        const emailNum = (lead.email_sent_count || 0) + 1;
        if (emailNum > 3) continue;

        const { subject, html, bodyText } = renderOutreachEmail({
          businessName: lead.business_name,
          emailSentCount: lead.email_sent_count || 0,
          firstMessage: summary?.recommended_first_message,
          followUp: summary?.recommended_follow_up,
        });

        console.log(`Sending email ${emailNum} to ${lead.business_name}...`);
        const result = await sendEmail(lead.email, subject, html);

        // Log the email
        await supabase.from("outreach_log").insert({
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

        // Update lead
        await supabase
          .from("leads")
          .update({
            email_sent_count: emailNum,
            status: `Email ${emailNum} Sent`,
          })
          .eq("id", lead.id);

        results.sent.push({
          leadId: lead.id,
          company: lead.business_name,
          email: lead.email,
          emailNum,
        });

        console.log(`✅ Sent email ${emailNum} to ${lead.business_name}`);
      } catch (err) {
        console.error(`Failed to send to ${lead.business_name}:`, err);
        results.failed.push({
          leadId: lead.id,
          company: lead.business_name,
          email: lead.email,
          error: err instanceof Error ? err.message : "Failed",
        });
      }

      if (results.sent.length >= remaining) break;
    }

    console.log(`✅ Daily email send complete: ${results.sent.length} sent, ${results.failed.length} failed`);

    return NextResponse.json({
      success: true,
      sent: results.sent.length,
      failed: results.failed.length,
      results,
      message: `Sent ${results.sent.length} emails (${emailsSentToday + results.sent.length}/25 today)`,
    });
  } catch (error) {
    console.error("Email send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email send failed" },
      { status: 500 }
    );
  }
}
