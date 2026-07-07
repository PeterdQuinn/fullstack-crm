import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";
import { renderOutreachEmail } from "@/lib/email-templates";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Count emails sent today
    const { count: sentCount } = await supabase
      .from("outreach_log")
      .select("*", { count: "exact", head: true })
      .eq("channel", "email")
      .gte("sent_at", `${today}T00:00:00Z`);

    const emailsSentToday = sentCount || 0;
    if (emailsSentToday >= 25) {
      return NextResponse.json({
        sent: [],
        failed: [],
        totalSent: 0,
        message: "Daily limit (25) reached",
      });
    }

    const remaining = 25 - emailsSentToday;

    console.log(`📧 Email quota: ${emailsSentToday}/25 sent today, ${remaining} remaining`);

    // Get leads that ACTUALLY qualify: a real AI score > 50, email present, not
    // opted out / bounced / complained, under the 3-email cap. The score filter
    // and ordering run in the query (inner join on lead_ai_summaries), so
    // `.limit(remaining)` keeps the highest-scoring qualifiers instead of an
    // arbitrary unordered page that could be all low/unscored leads (the bug
    // that made the button send 0 even when qualifying leads existed).
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, business_name, email, email_sent_count, lead_ai_summaries!inner(recommended_first_message, recommended_follow_up, main_pain_point, best_attack_angle, lead_score)")
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .gt("lead_ai_summaries.lead_score", 50)
      .order("lead_score", { referencedTable: "lead_ai_summaries", ascending: false })
      .limit(remaining);

    if (error) {
      console.error("Query error:", error);
      throw error;
    }

    console.log(`📋 Found ${leads?.length || 0} leads to process`);

    const results = { sent: [] as any[], failed: [] as any[] };

    for (const lead of leads || []) {
      const summary = Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] : lead.lead_ai_summaries;
      const score = summary?.lead_score || 0;

      console.log(`  Checking ${lead.business_name}: score=${score}, email=${lead.email}, sent=${lead.email_sent_count}`);

      if (score <= 50) {
        console.log(`    ❌ Score too low (${score})`);
        continue;
      }
      if (!lead.email) {
        console.log(`    ❌ No email`);
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

      try {
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
          success: true,
        });
      } catch (err) {
        results.failed.push({
          leadId: lead.id,
          company: lead.business_name,
          email: lead.email,
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    return NextResponse.json({
      sent: results.sent,
      failed: results.failed,
      totalSent: results.sent.length,
      message: `Sent ${results.sent.length} emails (${emailsSentToday + results.sent.length}/25 today)`,
    });
  } catch (error) {
    console.error("Email error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
