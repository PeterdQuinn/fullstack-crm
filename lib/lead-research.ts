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
const EMPTY_RESEARCH_RETRY_DAYS = 7;
// Public research can establish fit before contact data exists. Email consent
// and deliverability are evaluated later by the outreach pipeline.
const RESEARCHABLE = ["New", "Scored", "Ready for Outreach", "Follow-Up Scheduled"];

export type ResearchResult = {
  processed: number;
  researched: number;
  observations: number;
  creditsUsed: number;
  errors: string[];
};

type ResearchFactRow = {
  lead_id: string;
  field_name: string;
  label: string;
  field_value: string;
  certainty: "verified" | "single_source" | "ai_inference" | "not_found";
  source_label: string | null;
  source_url: string | null;
  source_count: number;
  researched_at: string;
};

/**
 * Keep public facts, opportunity hypotheses, and the next discovery question
 * together in the existing research-facts table. A public website cannot prove
 * a company's internal pain, so the opportunity is explicitly an inference.
 */
export function buildOperationalResearchFacts(
  lead: { id: string; business_name: string; city?: string | null; state?: string | null; website?: string | null },
  observations: InternetObservation[],
  researchedAt = new Date().toISOString(),
): ResearchFactRow[] {
  const sourced = observations.filter(item => item.value && /^https:\/\//i.test(item.sourceUrl));
  const best = [...sourced].sort((a, b) => (b.identityScore ?? 0) - (a.identityScore ?? 0))[0];
  const identity = [lead.business_name, [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
  const facts: Array<Omit<ResearchFactRow, "lead_id">> = [
    { field_name: "scheduled_business_identity", label: "Business researched", field_value: identity, certainty: "single_source", source_label: "CRM discovery record", source_url: lead.website || null, source_count: 1, researched_at: researchedAt },
    { field_name: "scheduled_retrieval_date", label: "Research retrieved", field_value: researchedAt, certainty: "verified", source_label: "Legion research run", source_url: lead.website || null, source_count: 1, researched_at: researchedAt },
  ];
  if (best) {
    facts.push({ field_name: "scheduled_observed_evidence", label: "Observed public evidence", field_value: best.value, certainty: best.evidenceType === "verified" ? "verified" : "single_source", source_label: best.sourceLabel, source_url: best.sourceUrl, source_count: best.corroborationCount || 1, researched_at: researchedAt });
  } else {
    facts.push({ field_name: "scheduled_observed_evidence", label: "Observed public evidence", field_value: "No specific operational evidence was established from the public sources retrieved.", certainty: "not_found", source_label: null, source_url: null, source_count: 0, researched_at: researchedAt });
  }

  const signal = sourced.find(item => ["hiring", "expansion", "advertising", "technology"].includes(item.category));
  const opportunity = signal
    ? signal.category === "hiring" || signal.category === "expansion"
      ? "Unverified workflow hypothesis: added hiring or expansion may make scheduling, handoffs, or follow-up worth exploring. Public evidence does not establish that the business has a problem."
      : signal.category === "advertising"
        ? "Unverified workflow hypothesis: public advertising activity makes lead intake and source attribution a relevant discovery topic. It does not establish a tracking gap."
        : "Unverified workflow hypothesis: the public technology signal makes repeated entry and handoffs between customer systems a relevant discovery topic. It does not establish rework."
    : "No evidence-backed operational opportunity hypothesis is available yet. Ask a neutral discovery question before assigning a business need.";
  facts.push({ field_name: "scheduled_operational_hypothesis", label: "Potential operational opportunity", field_value: opportunity, certainty: signal ? "ai_inference" : "not_found", source_label: signal?.sourceLabel || null, source_url: signal?.sourceUrl || null, source_count: signal ? signal.corroborationCount || 1 : 0, researched_at: researchedAt });

  const service = signal
    ? "AI systems consulting and workflow implementation"
    : "Business automation discovery (fit not established)";
  facts.push({ field_name: "scheduled_relevant_service", label: "Relevant Full Stack service", field_value: service, certainty: "ai_inference", source_label: signal?.sourceLabel || null, source_url: signal?.sourceUrl || null, source_count: signal ? signal.corroborationCount || 1 : 0, researched_at: researchedAt });
  const nextAction = signal
    ? signal.category === "hiring" || signal.category === "expansion"
      ? "Ask whether scheduling, onboarding, or customer follow-up has become harder to coordinate as the team or service area changes. Do not state that it has."
      : signal.category === "advertising"
        ? "Ask how new inquiries are assigned, followed up, and attributed. Do not claim that their current process is deficient."
        : "Ask where customer information is re-entered or handed between systems, if anywhere. Do not claim that rework exists."
    : "Gather one public, identity-matched operational signal or ask the business an open discovery question before preparing a need-specific message.";
  facts.push({ field_name: "scheduled_recommended_next_action", label: "Recommended next action", field_value: nextAction, certainty: "ai_inference", source_label: signal?.sourceLabel || null, source_url: signal?.sourceUrl || null, source_count: signal ? signal.corroborationCount || 1 : 0, researched_at: researchedAt });
  facts.push({ field_name: "scheduled_confidence", label: "Research confidence", field_value: signal ? `${signal.confidence} confidence; opportunity is an inference, not a verified client need.` : "Low confidence; no specific operational evidence retrieved.", certainty: "ai_inference", source_label: signal?.sourceLabel || null, source_url: signal?.sourceUrl || null, source_count: signal ? signal.corroborationCount || 1 : 0, researched_at: researchedAt });
  return facts.map(fact => ({ ...fact, lead_id: lead.id }));
}

export function operationalResearchSummary(observations: InternetObservation[]) {
  const evidence = observations.find(item => ["hiring", "expansion", "advertising", "technology"].includes(item.category) && /^https:\/\//i.test(item.sourceUrl));
  return evidence
    ? `Opportunity evidence: ${evidence.value} Potential fit is an unverified discovery hypothesis; ask how the related workflow operates. ${evidence.sourceUrl}`
    : "No specific public operational signal established; ask an open discovery question before assigning a need.";
}

export function dedupeResearchCandidates<T extends { business_name?: string | null; website?: string | null; city?: string | null; state?: string | null }>(leads: T[]) {
  const normalized = (value: unknown) => String(value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[^a-z0-9]/g, "");
  const seen = new Set<string>();
  return leads.filter(lead => {
    const location = normalized([lead.city, lead.state].filter(Boolean).join(" "));
    const website = normalized(lead.website);
    const key = website ? `web:${website}:${location}` : `name:${normalized(lead.business_name)}:${location}`;
    if (key === "name::") return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

  const candidateQuery = () => supabase
    .from("leads")
    .select("id, business_name, website, city, state, industry, niche, updated_at, phone, address, owner_name, technologies, google_rating, google_review_count, lead_internet_intelligence(researched_at,summary)")
    .eq("opt_out", false).eq("bounced", false).eq("complained", false)
    .neq("status", "Do Not Contact")
    .in("status", RESEARCHABLE)
    .is("archived_at", null)
    .order("updated_at", { ascending: true });
  const marketTerms = ["hvac", "heating", "cooling", "air conditioning", "roof", "floor", "insurance"];
  const marketFilter = marketTerms.flatMap(term => [
    `industry.ilike.%${term}%`, `niche.ilike.%${term}%`,
  ]).join(",");
  const [priorityResult, generalResult] = await Promise.all([
    candidateQuery().or(marketFilter).limit(500),
    candidateQuery().limit(500),
  ]);
  if (priorityResult.error || generalResult.error) {
    result.errors.push(`Cannot read research candidates: ${priorityResult.error?.message || generalResult.error?.message}`);
    return result;
  }

  const stale = Date.now() - RESEARCH_TTL_DAYS * 86_400_000;
  const priority = (value: unknown) => /hvac|heating|cooling|air conditioning|roof|floor|insurance/i.test(String(value || ""));
  const mergedCandidates = [...new Map([...(priorityResult.data || []), ...(generalResult.data || [])].map((lead: any) => [lead.id, lead])).values()];
  const orderedCandidates = dedupeResearchCandidates(mergedCandidates.sort((a: any, b: any) => {
    const aPriority = priority(`${a.industry || ""} ${a.niche || ""}`) ? 1 : 0;
    const bPriority = priority(`${b.industry || ""} ${b.niche || ""}`) ? 1 : 0;
    return bPriority - aPriority || String(a.updated_at || "").localeCompare(String(b.updated_at || ""));
  }));
  const due = orderedCandidates.filter((lead: any) => {
    const last = lead.lead_internet_intelligence?.[0]?.researched_at || lead.lead_internet_intelligence?.researched_at;
    if (!last) return true;
    const researchAge = Date.now() - Date.parse(last);
    const summary = lead.lead_internet_intelligence?.[0]?.summary || lead.lead_internet_intelligence?.summary || "";
    const retryDays = String(summary).startsWith("No specific public operational signal") ? EMPTY_RESEARCH_RETRY_DAYS : RESEARCH_TTL_DAYS;
    return researchAge > retryDays * 86_400_000;
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

      const researchedAt = new Date().toISOString();

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

      const facts = buildOperationalResearchFacts(lead, internet.observations, researchedAt);
      const { error: factsError } = await supabase.from("lead_research_facts").upsert(facts, { onConflict: "lead_id,field_name" });
      if (factsError) throw new Error(`Research findings were gathered but not saved: ${factsError.message}`);

      const { error: intelligenceError } = await supabase.from("lead_internet_intelligence").upsert({
        lead_id: lead.id, footprint_score: internet.footprintScore, momentum_score: internet.momentumScore,
        momentum_label: internet.momentumLabel, summary: operationalResearchSummary(internet.observations), provider: internet.provider,
        credits_used: internet.creditsUsed, researched_at: researchedAt,
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
