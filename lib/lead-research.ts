import { createClient } from "@supabase/supabase-js";
import { researchInternetPresence, isFirecrawlConfigured, type InternetObservation } from "@/lib/internet-intelligence";

// Automated internet research for leads heading into outreach.
//
// WHY THIS EXISTS: researchInternetPresence and the whole Firecrawl evidence
// pipeline shipped wired to exactly one caller — the manual /crm/research-center
// page. No scheduled job ever called it, so lead_internet_observations sat at
// zero rows and every automated email fell back to the generic opener. The
// personalised touch-1 copy had never once been sent when this was written.
//
// Research runs in the enrichment slot, an hour ahead of scoring and two ahead
// of sending, so evidence exists before anything reads it.

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Evidence goes stale; re-research a lead only after this long.
const RESEARCH_TTL_DAYS = 30;
// Statuses worth spending Firecrawl credits on — a lead we can still email.
const RESEARCHABLE = ["New", "Scored", "Ready for Outreach", "Follow-Up Scheduled"];

export type ResearchResult = {
  processed: number;
  researched: number;
  observations: number;
  creditsUsed: number;
  errors: string[];
};

function toObservation(row: any): InternetObservation {
  return {
    category: row.category, signal: row.signal, value: row.value,
    numericValue: row.numeric_value == null ? undefined : Number(row.numeric_value),
    sourceLabel: row.source_label, sourceUrl: row.source_url, confidence: row.confidence,
    growthDirection: row.growth_direction, observedAt: row.observed_at, identityScore: row.identity_score,
    matchReasons: row.match_reasons, evidenceType: row.evidence_type,
    publishedAt: row.published_at, corroborationCount: row.corroboration_count,
  };
}

// A single lead's research is four Firecrawl searches, up to five page scrapes
// and an LLM read. deadlineMs only stops another lead being started, so each
// lead also gets a hard cap — one slow source must not consume the route.
// Measured: four Firecrawl searches and five scrapes in parallel plus the LLM
// read runs 20-60s depending on how slow the slowest source is. 45s cut off
// healthy runs. deadlineMs is deliberately well below this so a second lead is
// only started when it can still finish inside the route's 120s ceiling.
const PER_LEAD_TIMEOUT_MS = 70_000;

export async function researchLeadsBatch(batchSize = 2, deadlineMs = 45_000): Promise<ResearchResult> {
  const startedAt = Date.now();
  const result: ResearchResult = { processed: 0, researched: 0, observations: 0, creditsUsed: 0, errors: [] };

  // A missing key must fail loudly. Silently producing no evidence is exactly
  // how this pipeline stayed broken through 352 sends.
  if (!isFirecrawlConfigured()) {
    result.errors.push("Firecrawl API key is not available to this runtime; no internet evidence can be gathered");
    return result;
  }

  const { data: candidates, error } = await supabase
    .from("leads")
    .select("id, business_name, website, city, state, phone, address, owner_name, technologies, google_rating, google_review_count, lead_internet_intelligence(researched_at)")
    .not("email", "is", null).neq("email", "")
    .eq("opt_out", false).eq("bounced", false)
    .neq("status", "Do Not Contact")
    .in("status", RESEARCHABLE)
    .is("archived_at", null)
    .order("updated_at", { ascending: true })
    .limit(100);
  if (error) {
    result.errors.push(`Cannot read research candidates: ${error.message}`);
    return result;
  }

  const stale = Date.now() - RESEARCH_TTL_DAYS * 86_400_000;
  const due = (candidates || []).filter((lead: any) => {
    const last = lead.lead_internet_intelligence?.[0]?.researched_at || lead.lead_internet_intelligence?.researched_at;
    return !last || Date.parse(last) < stale;
  }).slice(0, batchSize);

  for (const lead of due) {
    if (Date.now() - startedAt > deadlineMs) break;
    result.processed++;
    try {
      const { data: previousRows, error: previousError } = await supabase
        .from("lead_internet_observations").select("*").eq("lead_id", lead.id)
        .order("observed_at", { ascending: false }).limit(200);
      if (previousError) throw new Error(`Cannot read previous evidence: ${previousError.message}`);

      const internet = await Promise.race([
        researchInternetPresence(lead as any, (previousRows || []).map(toObservation)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Research exceeded ${PER_LEAD_TIMEOUT_MS / 1000}s`)), PER_LEAD_TIMEOUT_MS)),
      ]);

      if (internet.observations.length) {
        const { error: saveError } = await supabase.from("lead_internet_observations").insert(
          internet.observations.map((item) => ({
            lead_id: lead.id, category: item.category, signal: item.signal, value: item.value,
            numeric_value: item.numericValue ?? null, source_label: item.sourceLabel, source_url: item.sourceUrl,
            confidence: item.confidence, growth_direction: item.growthDirection, observed_at: item.observedAt,
            identity_score: item.identityScore ?? null, match_reasons: item.matchReasons || [],
            evidence_type: item.evidenceType || "single_source", published_at: item.publishedAt || null,
            corroboration_count: item.corroborationCount || 1,
          }))
        );
        if (saveError) throw new Error(`Evidence was gathered but not saved: ${saveError.message}`);
        result.observations += internet.observations.length;
      }

      const { error: intelligenceError } = await supabase.from("lead_internet_intelligence").upsert({
        lead_id: lead.id, footprint_score: internet.footprintScore, momentum_score: internet.momentumScore,
        momentum_label: internet.momentumLabel, summary: internet.summary, provider: internet.provider,
        credits_used: internet.creditsUsed, researched_at: new Date().toISOString(),
      });
      if (intelligenceError) throw new Error(`Research summary was not saved: ${intelligenceError.message}`);

      result.creditsUsed += internet.creditsUsed;
      result.researched++;
    } catch (err) {
      result.errors.push(`${lead.business_name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
