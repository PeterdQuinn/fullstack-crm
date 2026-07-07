import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/ai-scoring";
import { sendEmail } from "@/lib/resend";
import { renderOutreachEmail } from "@/lib/email-templates";

// Shared automation-pipeline logic, callable in-process (from the cron) or via
// the /api/admin/automation-pipeline HTTP route (from the UI). Running it
// in-process is what lets the daily cron work: the pipeline lives under
// /api/admin, which is now behind Basic Auth, so a self-HTTP call would 401.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Kept small so the whole cron (all three phases) completes inside the
// Hobby-tier ~60s function limit. Each scrape is a headless-browser call that
// can take several seconds, so the batch is tiny and every call is bounded by
// SCRAPE_TIMEOUT_MS. The 107-lead backlog is worked down over daily runs.
const SCRAPE_BATCH = 3;
const SCRAPE_TIMEOUT_MS = 9000;
// Leads scored per run — kept small (2–3) so a full batch (each an AI call plus
// a possible enrichment scrape) finishes well inside the ~60s function limit.
// Batches of 10 reliably 504'd; 3 completes with headroom.
const SCORE_BATCH = 3;
// Max emails per run. Sends fewer if fewer qualify — never forces a number.
const SEND_CAP_PER_RUN = 100;
// A lead must have all of these (non-null, non-empty) to be scored. City/state
// and other fields (socials, employees, founded_year, ...) may stay null.
const REQUIRED_FIELDS = ["business_name", "email", "phone"] as const;
// Real (non-fallback) scores strictly below this are deleted.
const SCORE_KEEP_THRESHOLD = 80;

type EmailedLead = { business_name: string; email: string; city: string | null; state: string | null };

export type PhaseResult =
  | { phase: "scrape"; considered: number; enriched: number; fieldsFound: number }
  | {
      phase: "score";
      considered: number;
      scored: number;
      kept: number;
      deleted: number;
      fallback: number;
      incompleteDeleted: number;
      enriched: number;
    }
  | { phase: "send"; eligible: number; sent: number; skipped: number; emailed: EmailedLead[] };

async function scrapeLeadData(lead: any) {
  // Bound every scrape so a single slow/hanging browser launch can't consume
  // the whole cron's 60s budget.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
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
        signal: controller.signal,
      }
    );
    return await res.json();
  } catch (error) {
    console.error(`Scrape failed/timed out for ${lead.business_name}:`, error);
    return {};
  } finally {
    clearTimeout(timer);
  }
}

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

  // PHASE 2: SCORE — enforce data completeness, then AI-score.
  if (phase === "score") {
    // Target UNSCORED leads directly. Pull the set of already-scored lead ids
    // first, then over-fetch the oldest leads and filter those out. Without this
    // anti-join, an unordered page can come back all-scored and the phase
    // no-ops forever, never reaching the unscored backlog.
    const { data: scoredRows } = await supabase
      .from("lead_ai_summaries")
      .select("lead_id");
    const scoredIds = new Set((scoredRows || []).map((r) => r.lead_id));

    const { data: pool } = await supabase
      .from("leads")
      .select(
        "id, business_name, email, phone, city, state, website, owner_name, short_description, industry, current_software, technologies, created_at"
      )
      .order("created_at", { ascending: true })
      .limit(SCORE_BATCH * 40);
    const candidates = (pool || [])
      .filter((l) => !scoredIds.has(l.id))
      .slice(0, SCORE_BATCH * 5);

    let considered = 0;
    let scored = 0;
    let kept = 0;
    let fallback = 0;
    let enriched = 0;

    // Deletions are DEFERRED: nothing is deleted inside the scoring loop. We
    // collect ids here and delete only after the loop finishes cleanly. If the
    // function times out (or throws) mid-batch, execution never reaches the
    // deletion block, so a failed/partial run deletes nothing — a pure no-op,
    // the same protection principle as the fallback-score guard below.
    const incompleteToDelete: string[] = []; // failed the completeness gate (never scored)
    const belowThresholdToDelete: string[] = []; // real provider scored them under the bar

    const isBlank = (v: any) => v === null || v === undefined || String(v).trim() === "";

    for (const lead of candidates || []) {
      if (considered >= SCORE_BATCH) break;
      try {
        const { data: existing } = await supabase
          .from("lead_ai_summaries")
          .select("id")
          .eq("lead_id", lead.id)
          .single();
        if (existing) continue; // already scored

        considered++;

        // --- Data-completeness gate (item 5) ---
        // Required fields must all be present. Missing ones get ONE targeted,
        // cheap enrichment attempt; if still missing, the lead is queued for
        // deletion AFTER the batch completes (never mid-loop).
        let missing = REQUIRED_FIELDS.filter((f) => isBlank((lead as any)[f]));
        if (missing.length > 0) {
          // The only cheap scraper path (scrape-phone) can fill email/phone and
          // needs a business_name to search. A lead missing business_name has
          // no scraper path and can't be enriched.
          const scrapeable = !isBlank(lead.business_name) && missing.some((f) => f === "email" || f === "phone");
          if (scrapeable) {
            const scraped = await scrapeLeadData(lead); // one bounded attempt, no LLM
            const updates: any = {};
            if (isBlank(lead.email) && scraped.email) { updates.email = scraped.email; lead.email = scraped.email; }
            if (isBlank(lead.phone) && scraped.phone) { updates.phone = scraped.phone; lead.phone = scraped.phone; }
            if (Object.keys(updates).length > 0) {
              await supabase.from("leads").update(updates).eq("id", lead.id);
              enriched++;
            }
            missing = REQUIRED_FIELDS.filter((f) => isBlank((lead as any)[f]));
          }

          if (missing.length > 0) {
            // Still missing a required field after the enrichment attempt.
            // Defer the delete — a timeout must never orphan-delete a lead
            // that was never actually scored.
            incompleteToDelete.push(lead.id);
            continue;
          }
        }

        // --- Scoring ---
        const summary = await scoreLead({
          business_name: lead.business_name,
          owner_name: lead.owner_name,
          industry: lead.industry,
          current_software: lead.current_software,
          technologies: lead.technologies,
          short_description: lead.short_description,
        });

        // "fallback" means EVERY AI provider failed and lead_score is a
        // placeholder (50), not a real judgment. Missing/unknown provider is
        // treated as fallback too, so we never delete on an uncertain score.
        const isFallback = (summary.provider || "fallback") === "fallback";
        if (isFallback) {
          // Leave the lead completely as-is: no summary persisted, no status
          // change, no delete. Re-scored next run once a provider recovers.
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

        if (score >= SCORE_KEEP_THRESHOLD) {
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
          // A REAL provider judged this lead below the bar (item 4). Defer the
          // delete to the post-loop block so a later timeout can't leave the
          // run half-deleted.
          belowThresholdToDelete.push(lead.id);
        }
      } catch (error) {
        console.error(`Error scoring ${lead.business_name}:`, error);
      }
    }

    // --- Deletion block: reached ONLY if the scoring loop completed. ---
    // A timeout/crash during the loop skips all of this, guaranteeing that a
    // failed run performs zero deletions.
    let incompleteDeleted = 0;
    let deleted = 0;
    for (const id of incompleteToDelete) {
      await supabase.from("leads").delete().eq("id", id);
      incompleteDeleted++;
    }
    for (const id of belowThresholdToDelete) {
      await supabase.from("leads").delete().eq("id", id);
      deleted++;
    }

    return { phase: "score", considered, scored, kept, deleted, fallback, incompleteDeleted, enriched };
  }

  // PHASE 3: SEND — email high-score leads, up to SEND_CAP_PER_RUN per run.
  if (phase === "send") {
    // Per-run cap only (item 3): fetch at most SEND_CAP_PER_RUN candidates and
    // send however many qualify — no per-day tracking, no forced count.
    const { data: leads } = await supabase
      .from("leads")
      .select(
        "id, business_name, email, city, state, email_sent_count, lead_ai_summaries(recommended_first_message, recommended_follow_up, lead_score)"
      )
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .limit(SEND_CAP_PER_RUN);

    let sent = 0;
    let skipped = 0;
    const emailed: EmailedLead[] = [];

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

      // Shared renderer — identical output to the manual Email Queue view.
      const rendered = renderOutreachEmail({
        businessName: lead.business_name,
        emailSentCount: lead.email_sent_count || 0,
        firstMessage: summary?.recommended_first_message,
        followUp: summary?.recommended_follow_up,
      });
      const { subject, html, bodyText } = rendered;

      try {
        const result = await sendEmail(lead.email, subject, html);
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
        await supabase
          .from("leads")
          .update({ email_sent_count: emailNum, status: `Email ${emailNum} Sent` })
          .eq("id", lead.id);
        sent++;
        // item 6: record exactly who was emailed and where.
        emailed.push({
          business_name: lead.business_name,
          email: lead.email,
          city: lead.city ?? null,
          state: lead.state ?? null,
        });
      } catch (err) {
        console.error(`Error sending to ${lead.business_name}:`, err);
        skipped++;
      }
    }

    return { phase: "send", eligible: (leads || []).length, sent, skipped, emailed };
  }

  throw new Error(`Unknown automation phase: ${phase}`);
}
