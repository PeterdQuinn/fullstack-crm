import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL_TEMPLATES = {
  1: (company: string, message: string) => ({
    subject: `Custom Solution for ${company} - Let's Chat`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi there,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Looking forward to connecting.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  2: (company: string, message: string) => ({
    subject: `Quick follow-up: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hey,</h2><p style="color: #666; line-height: 1.6;">Just wanted to follow up on my previous message.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Let me know if this is something worth exploring.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  3: (company: string, message: string) => ({
    subject: `Last chance: Custom solution for ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi,</h2><p style="color: #666; line-height: 1.6;">This is my last attempt to reach you about something I think could genuinely help.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">If you're not interested, no worries — I'll stop reaching out.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  4: (company: string, message: string) => ({
    subject: `We helped similar ${company.split(" ")[0]} companies save $400/mo`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">One more thing...</h2><p style="color: #666; line-height: 1.6;">I noticed you might be paying for multiple software subscriptions.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Most owners save $300-700/month after switching.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  5: (company: string, message: string) => ({
    subject: `Would ${company} benefit from custom software?`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Quick question,</h2><p style="color: #666; line-height: 1.6;">Are you currently using software that you're paying for monthly?</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Just wanted to see if this might be relevant.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  6: (company: string, message: string) => ({
    subject: `${company}: Is your current system limiting growth?`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">${company.split(" ")[0]},</h2><p style="color: #666; line-height: 1.6;">Many service businesses are stuck with off-the-shelf software that doesn't fit their needs.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Worth a conversation?</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  7: (company: string, message: string) => ({
    subject: `How much is your current software costing ${company}?`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Real quick,</h2><p style="color: #666; line-height: 1.6;">Most service owners spend $300-600/month on software they don't fully own.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">That's $3,600-7,200 a year. Worth exploring alternatives?</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  8: (company: string, message: string) => ({
    subject: `Built-for-you software vs subscription software`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi ${company.split(" ")[0]},</h2><p style="color: #666; line-height: 1.6;">The difference between renting software and owning it is huge.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Let's see if ownership makes sense for ${company}.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  9: (company: string, message: string) => ({
    subject: `5 minutes to see if we can help ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Hi,</h2><p style="color: #666; line-height: 1.6;">I know you're busy. That's exactly why we exist.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Just 5 minutes to see if this matters for you.</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
  10: (company: string, message: string) => ({
    subject: `Best time to implement custom software for ${company}?`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2 style="color: #333;">Curious about timing,</h2><p style="color: #666; line-height: 1.6;">Most businesses regret waiting to build custom software. They wished they'd done it sooner.</p><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #666; line-height: 1.6;">Is now the right time for ${company}?</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC<br>We build custom software for service businesses.</p></div>`,
  }),
};

export async function POST(req: NextRequest) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const DAY_IN_MS = 24 * 60 * 60 * 1000;

    const { data: sentToday, error: countError } = await supabase
      .from("outreach_log")
      .select("id")
      .eq("channel", "email")
      .gte("sent_at", `${today}T00:00:00Z`);

    if (countError) throw countError;

    const sentCount = sentToday?.length || 0;
    if (sentCount >= 25) {
      return NextResponse.json(
        { error: "Daily email limit (25) reached", sent: [] },
        { status: 429 }
      );
    }

    const remaining = 25 - sentCount;

    // Get leads with their scores
    const { data: leadsWithScores, error: leadsError } = await supabase
      .from("leads")
      .select(
        `id, business_name, email, status, email_sent_count,
        lead_ai_summaries(lead_score)`
      )
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .neq("status", "Do Not Contact")
      .neq("status", "Bad Email")
      .lt("email_sent_count", 3)
      .in("status", [
        "Ready for Outreach",
        "Email 1 Sent",
        "Email 2 Sent",
      ])
      .not("email", "is", null)
      .neq("email", "")
      .limit(remaining);

    // Filter by score > 50 only
    const leads = (leadsWithScores || []).filter((l: any) => {
      const score = l.lead_ai_summaries?.[0]?.lead_score || 0;
      return score > 50;
    });

    if (leadsError) throw leadsError;

    const emailSendResults = [];

    for (const lead of leads || []) {
      if (!lead.email) continue;

      const emailNumber = (lead.email_sent_count || 0) + 1;
      if (emailNumber > 3) continue;

      const { data: summary } = await supabase
        .from("lead_ai_summaries")
        .select("recommended_first_message, recommended_follow_up, main_pain_point, best_attack_angle")
        .eq("lead_id", lead.id)
        .single();

      let message = "";
      if (emailNumber === 1) {
        message = summary?.recommended_first_message || `Hi ${lead.business_name}, we've helped similar businesses in your space. Would love to chat about ${summary?.main_pain_point?.toLowerCase() || "how we can help"}.`;
      } else if (emailNumber === 2) {
        message = summary?.recommended_follow_up || `Just following up on my last message. ${summary?.best_attack_angle || "We think there's a real opportunity here for you."}`;
      } else {
        message = summary?.recommended_follow_up || "Final check: if this doesn't make sense for you right now, I respect that. But if you want to explore it, just let me know.";
      }

      const template =
        EMAIL_TEMPLATES[emailNumber as keyof typeof EMAIL_TEMPLATES];
      const { subject, html } = template(lead.business_name, message);

      try {
        const sendResult = await sendEmail(lead.email, subject, html);

        const { error: logError } = await supabase.from("outreach_log").insert({
          lead_id: lead.id,
          channel: "email",
          direction: "outbound",
          message_type: `email_${emailNumber}`,
          subject,
          message_body: message,
          status: "sent",
          provider: "resend",
          provider_message_id: sendResult.id,
          sent_at: new Date().toISOString(),
        });

        if (logError) throw logError;

        const newEmailCount = emailNumber;
        const newStatus =
          emailNumber === 1
            ? "Email 1 Sent"
            : emailNumber === 2
            ? "Email 2 Sent"
            : "Email 3 Sent";

        const { error: updateError } = await supabase
          .from("leads")
          .update({
            email_sent_count: newEmailCount,
            status: newStatus,
          })
          .eq("id", lead.id);

        if (updateError) throw updateError;

        // Auto-schedule next email
        if (emailNumber < 3) {
          const daysUntilNext = emailNumber === 1 ? 3 : 3;
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + daysUntilNext);
          dueDate.setHours(9, 0, 0, 0);

          await supabase.from("follow_up_tasks").insert({
            lead_id: lead.id,
            task_type: `send_email_${emailNumber + 1}`,
            due_at: dueDate.toISOString(),
            status: "pending",
          });
        }

        emailSendResults.push({
          leadId: lead.id,
          company: lead.business_name,
          email: lead.email,
          emailNumber,
          messageId: sendResult.id,
          success: true,
        });
      } catch (error) {
        emailSendResults.push({
          leadId: lead.id,
          company: lead.business_name,
          email: lead.email,
          emailNumber,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      sent: emailSendResults.filter((r) => r.success),
      failed: emailSendResults.filter((r) => !r.success),
      totalSent: emailSendResults.filter((r) => r.success).length,
    });
  } catch (error) {
    console.error("Email batch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email batch failed" },
      { status: 500 }
    );
  }
}
