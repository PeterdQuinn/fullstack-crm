import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/ai-scoring";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function scrapeLeadData(lead: any) {
  try {
    const body = {
      website: lead.website || undefined,
      business_name: lead.business_name,
      city: lead.city || "",
    };

    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return await res.json();
  } catch (error) {
    console.error(`Scrape failed for ${lead.business_name}:`, error);
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    console.log("🤖 Starting automation pipeline...");

    const { phase = "scrape" } = await req.json().catch(() => ({}));

    // PHASE 1: SCRAPE - Find leads missing critical data and enrich them
    if (phase === "scrape" || !phase) {
      console.log("📊 PHASE 1: Scraping leads for missing data...");

      const { data: leadsToScrape } = await supabase
        .from("leads")
        .select("*")
        .or("email.is.null,phone.is.null,owner_name.is.null")
        .limit(50);

      if (leadsToScrape && leadsToScrape.length > 0) {
        let scrapedCount = 0;
        let fieldsFound = 0;

        for (const lead of leadsToScrape) {
          const scrapedData = await scrapeLeadData(lead);
          const updates: any = {};

          if (scrapedData.email && !lead.email) updates.email = scrapedData.email;
          if (scrapedData.phone && !lead.phone) updates.phone = scrapedData.phone;
          if (scrapedData.owner && !lead.owner_name) updates.owner_name = scrapedData.owner;
          if (scrapedData.current_software && !lead.current_software)
            updates.current_software = scrapedData.current_software;
          if (scrapedData.description && !lead.short_description)
            updates.short_description = scrapedData.description;
          if (scrapedData.technologies && !lead.technologies)
            updates.technologies = scrapedData.technologies;
          if (scrapedData.yelp_url && !lead.yelp_url) updates.yelp_url = scrapedData.yelp_url;
          if (scrapedData.bbb_url && !lead.bbb_url) updates.bbb_url = scrapedData.bbb_url;

          if (Object.keys(updates).length > 0) {
            await supabase.from("leads").update(updates).eq("id", lead.id);
            scrapedCount++;
            fieldsFound += Object.keys(updates).length;
          }

          await new Promise((resolve) => setTimeout(resolve, 800));
        }

        console.log(`✓ Scraped ${leadsToScrape.length} leads, found ${fieldsFound} fields`);
      }
    }

    // PHASE 2: SCORE - Generate AI summaries for leads with emails
    if (phase === "score" || phase === "all" || !phase) {
      console.log("🎯 PHASE 2: Scoring leads...");

      const { data: leadsToScore } = await supabase
        .from("leads")
        .select("id, business_name, owner_name, short_description, industry, current_software, monthly_spend_estimate, technologies")
        .not("email", "is", null)
        .neq("email", "")
        .limit(100);

      if (leadsToScore && leadsToScore.length > 0) {
        let scoredCount = 0;
        let deletedCount = 0;

        for (const lead of leadsToScore) {
          try {
            // Check if already scored
            const { data: existing } = await supabase
              .from("lead_ai_summaries")
              .select("id")
              .eq("lead_id", lead.id)
              .single();

            if (existing) continue;

            const summary = await scoreLead({
              business_name: lead.business_name,
              owner_name: lead.owner_name,
              industry: lead.industry,
              current_software: lead.current_software,
              technologies: lead.technologies,
              short_description: lead.short_description,
            });
            const score = summary.lead_score || 0;

            // Upsert summary
            await supabase.from("lead_ai_summaries").upsert({
              lead_id: lead.id,
              main_pain_point: summary.main_pain_point,
              best_attack_angle: summary.best_attack_angle,
              recommended_first_message: summary.recommended_first_message,
              recommended_follow_up: summary.recommended_follow_up,
              lead_score: score,
              confidence_level: summary.confidence_level,
              missing_data_needed: summary.missing_data_needed,
            });

            if (score > 50) {
              scoredCount++;
              // Set status to Ready for Outreach
              const { data: leadData } = await supabase
                .from("leads")
                .select("status")
                .eq("id", lead.id)
                .single();

              if (leadData && (!leadData.status || leadData.status === "New")) {
                await supabase
                  .from("leads")
                  .update({ status: "Ready for Outreach" })
                  .eq("id", lead.id);
              }
            } else {
              // Delete low-score leads
              await supabase.from("leads").delete().eq("id", lead.id);
              deletedCount++;
            }

            await new Promise((resolve) => setTimeout(resolve, 600));
          } catch (error) {
            console.error(`Error scoring ${lead.business_name}:`, error);
          }
        }

        console.log(`✓ Scored ${leadsToScore.length} leads: ${scoredCount} kept, ${deletedCount} deleted`);
      }
    }

    // PHASE 3: SEND - Send emails to high-score leads
    if (phase === "send" || phase === "all" || !phase) {
      console.log("📧 PHASE 3: Sending emails...");

      const today = new Date().toISOString().split("T")[0];
      const { count: sentCount } = await supabase
        .from("outreach_log")
        .select("*", { count: "exact", head: true })
        .eq("channel", "email")
        .gte("sent_at", `${today}T00:00:00Z`);

      const emailsSentToday = sentCount || 0;
      const remaining = Math.max(0, 25 - emailsSentToday);

      if (remaining > 0) {
        const { sendEmail } = await import("@/lib/resend");

        const { data: leads } = await supabase
          .from("leads")
          .select(
            "id, business_name, email, email_sent_count, lead_ai_summaries(recommended_first_message, recommended_follow_up, lead_score)"
          )
          .eq("opt_out", false)
          .eq("bounced", false)
          .eq("complained", false)
          .not("email", "is", null)
          .neq("email", "")
          .lt("email_sent_count", 3)
          .limit(remaining);

        let sentCount = 0;
        const TEMPLATES = {
          1: (company: string, message: string) => ({
            subject: `Custom Solution for ${company} - Let's Chat`,
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>Hi,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
          }),
          2: (company: string, message: string) => ({
            subject: `Follow-up: ${company}`,
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>Hey,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
          }),
          3: (company: string, message: string) => ({
            subject: `Last message: ${company}`,
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>One final message,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
          }),
        };

        for (const lead of leads || []) {
          const summary = Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] : lead.lead_ai_summaries;
          const score = summary?.lead_score || 0;

          if (score <= 50 || !lead.email) continue;

          const emailNum = (lead.email_sent_count || 0) + 1;
          if (emailNum > 3) continue;

          const msg =
            emailNum === 1
              ? summary?.recommended_first_message ||
                `Hi ${lead.business_name}, we build custom software for service businesses like yours.`
              : emailNum === 2
              ? summary?.recommended_follow_up ||
                `Following up on our previous message about custom software for ${lead.business_name}.`
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

            sentCount++;
            console.log(`✓ Sent email ${emailNum} to ${lead.business_name}`);
          } catch (err) {
            console.error(`Error sending to ${lead.business_name}:`, err);
          }
        }

        console.log(`✓ Sent ${sentCount} emails (${emailsSentToday + sentCount}/25 today)`);
      } else {
        console.log(`⚠️  Daily email limit reached (25/25)`);
      }
    }

    return NextResponse.json({
      success: true,
      message: "✅ Automation pipeline completed",
    });
  } catch (error) {
    console.error("Pipeline error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pipeline failed" },
      { status: 500 }
    );
  }
}
