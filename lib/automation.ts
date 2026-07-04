import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/ai-scoring";
import { sendEmail } from "@/lib/resend";

// Shared automation-pipeline logic, callable in-process (from the cron) or via
// the /api/admin/automation-pipeline HTTP route (from the UI). Running it
// in-process is what lets the daily cron work: the pipeline lives under
// /api/admin, which is now behind Basic Auth, so a self-HTTP call would 401.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Kept small so the whole cron (all three phases) completes inside the
// Hobby-tier ~60s function limit. Each scrape is a headless-browser call.
const SCRAPE_BATCH = 8;
const DAILY_EMAIL_CAP = 25;

export type PhaseResult =
  | { phase: "scrape"; considered: number; enriched: number; fieldsFound: number }
  | { phase: "score"; considered: number; scored: number; kept: number; deleted: number; fallback: number }
  | { phase: "send"; eligible: number; sent: number; skipped: number; capReached: boolean };

async function scrapeLeadData(lead: any) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: lead.website || undefined,
          business_name: lead.business_name,
          city: lead.city || "",
        }),
      }
    );
    return await res.json();
  } catch (error) {
    console.error(`Scrape failed for ${lead.business_name}:`, error);
    return {};
  }
}

const TEMPLATES: Record<number, (company: string, message: string) => { subject: string; html: string }> = {
  1: (company, message) => ({
    subject: `Custom Solution for ${company} - Let's Chat`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>Hi,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
  2: (company, message) => ({
    subject: `Follow-up: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>Hey,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
  3: (company, message) => ({
    subject: `Last message: ${company}`,
    html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>One final message,</h2><p style="color: #666; line-height: 1.6;">${message}</p><p style="color: #999; font-size: 12px; margin-top: 30px;">Full Stack Services LLC</p></div>`,
  }),
};

export async function runAutomationPhase(phase: string): Promise<PhaseResult> {
  // PHASE 1: SCRAPE — enrich existing leads missing critical data.
  if (phase === "scrape") {
    const { data: leadsToScrape } = await supabase
      .from("leads")
      .select("*")
      .or("email.is.null,phone.is.null,owner_name.is.null")
      .limit(SCRAPE_BATCH);

    let enriched = 0;
    let fieldsFound = 0;

    for (const lead of leadsToScrape || []) {
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

      if (Object.keys(updates).length > 0) {
        await supabase.from("leads").update(updates).eq("id", lead.id);
        enriched++;
        fieldsFound += Object.keys(updates).length;
      }
    }

    return { phase: "scrape", considered: (leadsToScrape || []).length, enriched, fieldsFound };
  }

  // PHASE 2: SCORE — generate AI summaries for scored-worthy leads.
  if (phase === "score") {
    const { data: leadsToScore } = await supabase
      .from("leads")
      .select(
        "id, business_name, owner_name, short_description, industry, current_software, monthly_spend_estimate, technologies"
      )
      .not("email", "is", null)
      .neq("email", "")
      .limit(100);

    let scored = 0;
    let kept = 0;
    let deleted = 0;
    let fallback = 0;

    for (const lead of leadsToScore || []) {
      try {
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

        // scoreLead tags the winning provider on `provider`; "fallback" means
        // EVERY AI provider failed and lead_score is a placeholder (50), not a
        // real judgment. Missing/unknown provider is treated as fallback too so
        // we never delete on an uncertain score.
        const isFallback = (summary.provider || "fallback") === "fallback";
        if (isFallback) {
          // Leave the lead completely as-is: no summary persisted, no status
          // change, no delete. Because no summary row is written, the next run
          // re-scores this lead once providers recover.
          fallback++;
          continue;
        }

        const score = summary.lead_score || 0;
        scored++;

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
          kept++;
          const { data: leadData } = await supabase
            .from("leads")
            .select("status")
            .eq("id", lead.id)
            .single();
          if (leadData && (!leadData.status || leadData.status === "New")) {
            await supabase.from("leads").update({ status: "Ready for Outreach" }).eq("id", lead.id);
          }
        } else {
          // Only delete when a REAL provider judged this lead low-value (<=50).
          await supabase.from("leads").delete().eq("id", lead.id);
          deleted++;
        }
      } catch (error) {
        console.error(`Error scoring ${lead.business_name}:`, error);
      }
    }

    return { phase: "score", considered: (leadsToScore || []).length, scored, kept, deleted, fallback };
  }

  // PHASE 3: SEND — email high-score leads, respecting the daily cap.
  if (phase === "send") {
    const today = new Date().toISOString().split("T")[0];
    const { count } = await supabase
      .from("outreach_log")
      .select("*", { count: "exact", head: true })
      .eq("channel", "email")
      .gte("sent_at", `${today}T00:00:00Z`);

    const sentToday = count || 0;
    const remaining = Math.max(0, DAILY_EMAIL_CAP - sentToday);
    if (remaining <= 0) {
      return { phase: "send", eligible: 0, sent: 0, skipped: 0, capReached: true };
    }

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

    let sent = 0;
    let skipped = 0;

    for (const lead of leads || []) {
      const summary = Array.isArray(lead.lead_ai_summaries)
        ? lead.lead_ai_summaries[0]
        : lead.lead_ai_summaries;
      const score = summary?.lead_score || 0;

      if (score <= 50 || !lead.email) {
        skipped++;
        continue;
      }

      const emailNum = (lead.email_sent_count || 0) + 1;
      if (emailNum > 3) {
        skipped++;
        continue;
      }

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
        await supabase
          .from("leads")
          .update({ email_sent_count: emailNum, status: `Email ${emailNum} Sent` })
          .eq("id", lead.id);
        sent++;
      } catch (err) {
        console.error(`Error sending to ${lead.business_name}:`, err);
        skipped++;
      }
    }

    return { phase: "send", eligible: (leads || []).length, sent, skipped, capReached: false };
  }

  throw new Error(`Unknown automation phase: ${phase}`);
}
