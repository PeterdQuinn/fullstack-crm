import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TEMPLATES = {
  1: (company: string, message: string) => ({
    subject: `Custom Solution for ${company} - Let's Chat`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
  2: (company: string, message: string) => ({
    subject: `Follow-up: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hey,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
  3: (company: string, message: string) => ({
    subject: `Last message: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">One final message,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
};

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

    // Get leads with score > 50, email exists, not sent 3 times yet
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, business_name, email, email_sent_count, lead_ai_summaries(recommended_first_message, recommended_follow_up, main_pain_point, best_attack_angle, lead_score)")
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .limit(remaining);

    if (error) {
      console.error("Query error:", error);
      throw error;
    }

    console.log(`📋 Found ${leads?.length || 0} leads to process`);

    const results = { sent: [] as any[], failed: [] as any[] };

    for (const lead of leads || []) {
      const summary = lead.lead_ai_summaries;
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

      const msg =
        emailNum === 1
          ? summary?.recommended_first_message || `Hi ${lead.business_name}, we build custom software for service businesses like yours.`
          : emailNum === 2
          ? summary?.recommended_follow_up || `Following up on our previous message about custom software for ${lead.business_name}.`
          : `Final follow-up: custom software solution for ${lead.business_name}`;

      const template = TEMPLATES[emailNum as keyof typeof TEMPLATES];
      const { subject, html } = template(lead.business_name, msg);

      try {
        const result = await sendEmail(lead.email, subject, html);

        // Log the email
        await supabase.from("outreach_log").insert({
          lead_id: lead.id,
          channel: "email",
          direction: "outbound",
          message_type: `email_${emailNum}`,
          subject,
          message_body: msg,
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
