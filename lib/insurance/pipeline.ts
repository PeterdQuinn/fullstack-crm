import { createHash } from "node:crypto";
import { getChain, runChainJson } from "@/lib/ai-providers";
import { bestEmail } from "@/lib/email-extract";
import { looksLikeRealEmail } from "@/lib/email-validation";
import { insuranceDb, reserveInsuranceRequest } from "./db";
import { searchInsurance } from "./search";
import { safePublicUrl, INSURANCE_STATES, type InsuranceState, type InsuranceTrack } from "./types";
import { sendInsuranceTouch, sendRefusal } from "./outreach";

// The insurance pipeline, stage by stage.
//
// It is a deliberate copy of the HVAC pipeline's shape — discover, enrich,
// qualify, send, follow up — because that shape has already been debugged
// against live data. What is NOT copied is the assumption that a search result
// describes a person: a recruiting hit is a public page that mentions someone,
// and a buyer-signal hit is a public post. Both are leads to a conversation,
// never a verified licence record or a statement of purchase intent, and the
// copy that reaches them says nothing that depends on either being true.

export interface InsuranceSettings {
  enabled: boolean;
  sending_enabled: boolean;
  autopilot: boolean;
  tracks: string[];
  states: string[];
  queries: { track: string; query: string }[];
  daily_send_cap: number;
  sequence_gap_days: number;
  min_score: number;
}

export async function insuranceSettings(): Promise<InsuranceSettings> {
  const { data, error } = await insuranceDb().from("insurance_settings").select("*").eq("id", "owner").single();
  if (error) throw new Error(`Could not read insurance settings: ${error.message}`);
  return data as InsuranceSettings;
}

async function activity(prospectId: string, kind: string, summary: string, detail: Record<string, unknown> = {}, actor = "automation") {
  const { error } = await insuranceDb().from("insurance_activities").insert({ prospect_id: prospectId, kind, summary, detail, actor });
  // A lost timeline entry must not roll back real work that already happened.
  if (error) console.error(`Insurance activity not recorded (${kind}): ${error.message}`);
}

// ── 1. Discover ────────────────────────────────────────────────────────────

export interface DiscoverResult {
  track: string;
  state: string;
  query: string;
  found: number;
  imported: number;
  duplicates: number;
  provider?: string;
  warning?: string;
}

/**
 * One rotated track x state per run, saved as Research records.
 *
 * Deduplication is on the source URL, the same key the manual save uses, so a
 * scheduled run and a human clicking "Save for review" can never create two
 * records for one page.
 */
export async function discoverInsuranceProspects(settings: InsuranceSettings): Promise<DiscoverResult> {
  const db = insuranceDb();
  const { data: target, error } = await db.rpc("next_insurance_target");
  if (error) throw new Error(`Could not rotate the insurance target: ${error.message}`);

  const track = target.track as InsuranceTrack;
  const state = target.state as InsuranceState;
  const saved = (settings.queries || []).filter((q) => q.track === track).map((q) => q.query);
  const query = saved.length ? saved[Number(target.cursor || 0) % saved.length] : "";

  const result = await searchInsurance(
    { track, state, query },
    {
      reserve: reserveInsuranceRequest,
      serpKey: process.env.SERPAPI_API_KEY,
      ollamaKey: process.env.PRODUCERFORGE_OLLAMA_API_KEY,
    }
  );

  let imported = 0;
  let duplicates = 0;
  for (const source of result.sources) {
    const url = safePublicUrl(source.url);
    if (!url) continue;
    const source_key = createHash("sha256").update(url).digest("hex");
    const { data: existing } = await db
      .from("insurance_prospects")
      .select("id")
      .eq("track", track)
      .eq("state", state)
      .eq("source_key", source_key)
      .maybeSingle();
    if (existing) {
      duplicates++;
      continue;
    }
    const { data: created, error: saveError } = await db
      .from("insurance_prospects")
      .insert({
        track,
        state,
        name: source.title.slice(0, 200),
        source: { ...source, url },
        source_key,
        stage: "Research",
        discovered_by: "automation",
      })
      .select("id")
      .single();
    if (saveError) {
      console.error(`Insurance prospect not saved: ${saveError.message}`);
      continue;
    }
    imported++;
    await activity(created.id, "discovered", `Found by scheduled search of ${INSURANCE_STATES[state]}`, { query: result.query, provider: result.provider, url });
  }

  return { track, state, query: result.query, found: result.sources.length, imported, duplicates, provider: result.provider, warning: result.warning };
}

// ── 2. Enrich ──────────────────────────────────────────────────────────────

export interface EnrichResult {
  processed: number;
  emailsFound: number;
  errors: string[];
}

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Read the source page for a contact address.
 *
 * Uses lib/email-extract, so it sees the same Cloudflare-obfuscated, JSON-LD
 * and entity-encoded addresses the HVAC scraper now sees, and applies the same
 * ranking — the page's own domain first, a vendor's address never.
 */
export async function enrichInsuranceProspects(batchSize = 8, deadlineMs = 45_000): Promise<EnrichResult> {
  const startedAt = Date.now();
  const db = insuranceDb();
  const result: EnrichResult = { processed: 0, emailsFound: 0, errors: [] };

  const { data: prospects, error } = await db
    .from("insurance_prospects")
    .select("id, name, source, website, email, stage")
    .eq("email", "")
    .eq("opt_out", false)
    .neq("stage", "Do not contact")
    .order("updated_at", { ascending: true })
    .limit(Math.min(batchSize, 20));
  if (error) {
    result.errors.push(`Cannot read enrichment candidates: ${error.message}`);
    return result;
  }

  for (const prospect of prospects || []) {
    if (Date.now() - startedAt > deadlineMs) break;
    result.processed++;
    const targets = [prospect.website, prospect.source?.url].map((value) => safePublicUrl(value)).filter(Boolean);
    let found: string | null = null;
    for (const url of targets) {
      try {
        const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000), redirect: "follow" });
        if (!response.ok) continue;
        const html = await response.text();
        const candidate = bestEmail(html, new URL(url).host);
        if (candidate && looksLikeRealEmail(candidate)) {
          found = candidate;
          break;
        }
      } catch {
        // A page that will not load is not an error worth failing the run over.
      }
    }

    const updates: Record<string, unknown> = { enriched_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (found) updates.email = found;
    const { error: saveError } = await db.from("insurance_prospects").update(updates).eq("id", prospect.id);
    if (saveError) {
      result.errors.push(`${prospect.name}: ${saveError.message}`);
      continue;
    }
    if (found) {
      result.emailsFound++;
      await activity(prospect.id, "enriched", `Found contact address ${found}`, { email: found });
    }
  }

  return result;
}

// ── 3. Qualify ─────────────────────────────────────────────────────────────

const QUALIFY_SCHEMA = `{"score": <0-100 integer>, "reason": "<one sentence, under 200 characters>", "confidence": "low|medium|high"}`;

function qualifyPrompt(prospect: any): string {
  const isRecruiting = prospect.track === "recruiting";
  return `You are helping an insurance agency owner decide whether a public search result is worth a personal conversation.

WHAT WE HAVE
Name or page title: ${prospect.name}
State: ${INSURANCE_STATES[prospect.state as InsuranceState] || prospect.state}
Track: ${isRecruiting ? "recruiting a producer to work with" : "a member of the public who may have insurance questions"}
Source page: ${prospect.source?.url || "unknown"}
Source title: ${prospect.source?.title || ""}
Source excerpt: ${(prospect.source?.snippet || "").slice(0, 1200)}
Contact address on file: ${prospect.email ? "yes" : "no"}

SCORE 0-100 for how much this looks like ${isRecruiting
    ? "a real, individually identifiable insurance producer a recruiter could sensibly approach"
    : "a real person who has publicly asked about insurance and could sensibly be offered help"}.

Score HIGH only when the page is about one identifiable person.
Score LOW for: a directory index, a company's About page with no individual, a news article, a job board aggregator, a listicle, a page about a different industry, or anything where the person cannot be told apart from the page's other names.

You are NOT judging licence status, income, buying intent, or quality of any person. You are judging whether this page identifies someone worth writing to.

Return ONLY JSON: ${QUALIFY_SCHEMA}`;
}

export interface QualifyResult {
  processed: number;
  scored: number;
  qualified: number;
  errors: string[];
}

export async function qualifyInsuranceProspects(batchSize = 5): Promise<QualifyResult> {
  const db = insuranceDb();
  const result: QualifyResult = { processed: 0, scored: 0, qualified: 0, errors: [] };

  const { data: prospects, error } = await db
    .from("insurance_prospects")
    .select("id, name, track, state, source, email, score, stage")
    .is("score", null)
    .neq("stage", "Do not contact")
    .order("created_at", { ascending: true })
    .limit(Math.min(batchSize, 20));
  if (error) {
    result.errors.push(`Cannot read qualification candidates: ${error.message}`);
    return result;
  }

  for (const prospect of prospects || []) {
    result.processed++;
    try {
      const scored = await runChainJson<{ score: number; reason: string; confidence: string }>(
        getChain("scoring"),
        qualifyPrompt(prospect),
        {
          label: "insurance-qualify",
          validate: (parsed) => parsed && Number.isFinite(Number(parsed.score)),
        }
      );
      // Every provider down means the record waits, exactly as lead scoring
      // does. A placeholder score is a lie that survives in the data.
      if (!scored?.data) {
        result.errors.push(`${prospect.name}: no AI provider was available`);
        continue;
      }
      const score = Math.max(0, Math.min(100, Math.round(Number(scored.data.score))));
      const { error: saveError } = await db.rpc("save_insurance_score", {
        p_id: prospect.id,
        p_score: {
          score,
          reason: String(scored.data.reason || "").slice(0, 200),
          confidence: ["low", "medium", "high"].includes(String(scored.data.confidence)) ? scored.data.confidence : "medium",
          provider: scored.provider,
        },
      });
      if (saveError) throw new Error(saveError.message);
      result.scored++;
      const settings = await insuranceSettings();
      if (score >= settings.min_score) result.qualified++;
    } catch (err) {
      result.errors.push(`${prospect.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ── 4. Send ────────────────────────────────────────────────────────────────

export interface SendResult {
  eligible: number;
  sent: number;
  skipped: number;
  refusals: Record<string, number>;
  errors: string[];
  paused?: string;
}

/**
 * First touches and due follow-ups, both bounded by the shared daily budget.
 *
 * Due follow-ups go first: someone already contacted is mid-conversation, and
 * dropping them to start a new one is the worst possible use of the budget.
 */
export async function sendInsuranceOutreach(settings: InsuranceSettings, perRun = 8): Promise<SendResult> {
  const db = insuranceDb();
  const result: SendResult = { eligible: 0, sent: 0, skipped: 0, refusals: {}, errors: [] };

  if (!settings.sending_enabled) {
    result.paused = "Insurance sending is switched off in settings";
    return result;
  }

  const now = new Date().toISOString();
  const { data: dueTasks } = await db
    .from("insurance_tasks")
    .select("id, prospect_id, task_type")
    .eq("status", "pending")
    .lte("due_at", now)
    .like("task_type", "send_touch_%")
    .order("due_at", { ascending: true })
    .limit(perRun);

  const followUpIds = [...new Set((dueTasks || []).map((t) => t.prospect_id))];

  const { data: firstTouch, error: firstError } = await db
    .from("insurance_prospects")
    .select("*")
    .eq("stage", "Qualified")
    .eq("email_sent_count", 0)
    .eq("opt_out", false)
    .eq("bounced", false)
    .eq("complained", false)
    .neq("email", "")
    .gte("score", settings.min_score)
    .is("replied_at", null)
    .order("score", { ascending: false })
    .limit(perRun);
  if (firstError) {
    result.errors.push(`Cannot read outreach candidates: ${firstError.message}`);
    return result;
  }

  const { data: followUps } = followUpIds.length
    ? await db.from("insurance_prospects").select("*").in("id", followUpIds)
    : { data: [] as any[] };

  const queue = [...(followUps || []), ...(firstTouch || [])].slice(0, perRun);
  result.eligible = queue.length;

  for (const prospect of queue) {
    const refusal = sendRefusal(prospect, settings.min_score);
    if (refusal) {
      result.skipped++;
      result.refusals[refusal] = (result.refusals[refusal] || 0) + 1;
      continue;
    }
    try {
      const outcome = await sendInsuranceTouch(prospect, {
        dailyCap: settings.daily_send_cap,
        minScore: settings.min_score,
      });
      if (outcome.sent) result.sent++;
      else {
        result.skipped++;
        result.refusals[outcome.reason || "deferred"] = (result.refusals[outcome.reason || "deferred"] || 0) + 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A deferral is the outbox protecting the daily budget, not a failure.
      if (message.startsWith("Email deferred:")) {
        result.skipped++;
        result.refusals["daily cap"] = (result.refusals["daily cap"] || 0) + 1;
        continue;
      }
      result.errors.push(`${prospect.name}: ${message}`);
      await activity(prospect.id, "error", `Send failed: ${message.slice(0, 180)}`);
    }
  }

  return result;
}
