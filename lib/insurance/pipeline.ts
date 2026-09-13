import { createHash } from "node:crypto";
import { getChain, runChainJson } from "@/lib/ai-providers";
import { bestEmail } from "@/lib/email-extract";
import { looksLikeRealEmail } from "@/lib/email-validation";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { insuranceDb, reserveInsuranceRequest } from "./db";
import { searchInsurance } from "./search";
import { safePublicUrl, INSURANCE_STATES, type InsuranceState, type InsuranceTrack } from "./types";
import { isImportable, sourceKind, DEFAULT_QUERIES, hostOf } from "./sources";
import { findDuplicate, survivor } from "./dedupe";
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
  /** Results refused before import because the domain can never yield a lead. */
  filtered: number;
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
  // The owner's own queries win. Otherwise rotate the curated set, which aims
  // at pages that publish a way to reach someone — the first live run returned
  // ten LinkedIn profiles and ten quote farms, and produced zero contactable
  // leads out of twenty records.
  const saved = (settings.queries || []).filter((q) => q.track === track).map((q) => q.query);
  const pool = saved.length ? saved : [...(DEFAULT_QUERIES[track] || [])];
  const query = pool.length ? pool[Number(target.cursor || 0) % pool.length] : "";

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
  let filtered = 0;
  for (const source of result.sources) {
    const url = safePublicUrl(source.url);
    if (!url) continue;
    // A quote farm, a listicle or a carrier's own site cannot become a lead,
    // whatever the query was. Importing it only fills the board with rows that
    // score 10 and sit at Research forever.
    if (!isImportable(url, track)) {
      filtered++;
      continue;
    }
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
        website: sourceKind(url) === "agency" ? `https://${hostOf(url)}` : "",
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

  return { track, state, query: result.query, found: result.sources.length, imported, duplicates, filtered, provider: result.provider, warning: result.warning };
}

// ── 2. Enrich ──────────────────────────────────────────────────────────────

export interface EnrichResult {
  processed: number;
  emailsFound: number;
  phonesFound: number;
  /** Records linked to an existing one because the contact details matched. */
  merged: number;
  errors: string[];
}

/**
 * Link a record to the one it duplicates, if any. Returns true when merged.
 *
 * The duplicate is kept and pointed at its survivor rather than deleted: the
 * rule deliberately refuses several pairs a human might merge by eye, so the
 * decisions it does make have to be visible and reversible.
 */
async function mergeIfDuplicate(record: { id: string; name?: string | null; email?: string | null; phone?: string | null; created_at?: string | null }): Promise<boolean> {
  const db = insuranceDb();
  const { data: others, error } = await db
    .from("insurance_prospects")
    .select("id, name, email, phone, created_at, stage, notes")
    .is("duplicate_of", null)
    .or(`email.eq.${record.email || "__none__"},phone.eq.${record.phone || "__none__"}`)
    .limit(20);
  if (error || !others?.length) return false;

  const match = findDuplicate(record as any, others as any);
  if (!match) return false;

  const { data: full } = await db.from("insurance_prospects").select("id, name, email, phone, created_at").eq("id", record.id).single();
  const { keep, merge } = survivor(full as any, match.of as any);
  if (keep.id === merge.id) return false;

  const { error: linkError } = await db.from("insurance_prospects").update({
    duplicate_of: keep.id,
    duplicate_reason: `matched ${keep.name || "another record"} on ${match.reason}`,
    updated_at: new Date().toISOString(),
  }).eq("id", merge.id);
  if (linkError) {
    console.error(`Could not link duplicate: ${linkError.message}`);
    return false;
  }
  // Cancel anything queued against the record that is no longer the one worked.
  await db.from("insurance_tasks").update({ status: "cancelled", completed_at: new Date().toISOString(), notes: "Cancelled: merged into another record" })
    .eq("prospect_id", merge.id).eq("status", "pending");
  await activity(merge.id, "note", `Merged into ${keep.name || "an earlier record"} — matched on ${match.reason}`, { duplicate_of: keep.id, reason: match.reason });
  await activity(keep.id, "note", `A second source page for this contact was merged in — matched on ${match.reason}`, { merged_id: merge.id, reason: match.reason });
  return true;
}

// A US number as it appears in page text. Validated with libphonenumber before
// it is saved, because a date, a licence number and a price all look like
// digits to a regex.
const PHONE_PATTERN = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;

/** The first number on the page that is a real, dialable US number. */
function bestPhone(html: string): string | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  const seen = new Set<string>();
  for (const match of text.match(PHONE_PATTERN) || []) {
    const cleaned = match.trim();
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    const parsed = parsePhoneNumberFromString(cleaned, "US");
    if (parsed?.isValid()) return parsed.formatNational();
  }
  return null;
}

/** A business site's likeliest contact pages, tried after the page itself. */
function contactPages(website: string): string[] {
  try {
    const origin = new URL(website).origin;
    return ["/contact", "/contact-us", "/about", "/our-team", "/agents"].map((path) => `${origin}${path}`);
  } catch {
    return [];
  }
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
  const result: EnrichResult = { processed: 0, emailsFound: 0, phonesFound: 0, merged: 0, errors: [] };

  // Anything still missing a way to reach it. Phone matters as much as email
  // here: the best recruiting records come off profile networks that will never
  // publish an address, and a producer with a phone number is a lead you can
  // work today.
  const { data: prospects, error } = await db
    .from("insurance_prospects")
    .select("id, name, source, website, email, phone, stage, created_at")
    .is("duplicate_of", null)
    .or("email.eq.,phone.eq.")
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

    const targets = [prospect.source?.url, prospect.website]
      .map((value) => safePublicUrl(value))
      .filter(Boolean);
    // An agency site keeps its details on /contact far more often than on the
    // page a search engine happened to rank.
    if (prospect.website && sourceKind(prospect.website) === "agency") {
      targets.push(...contactPages(prospect.website));
    }

    let email: string | null = null;
    let phone: string | null = null;
    for (const url of [...new Set(targets)].slice(0, 4)) {
      if (email && phone) break;
      try {
        const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000), redirect: "follow" });
        if (!response.ok) continue;
        const html = await response.text();
        if (!email) {
          const candidate = bestEmail(html, new URL(url).host);
          if (candidate && looksLikeRealEmail(candidate)) email = candidate;
        }
        if (!phone) phone = bestPhone(html);
      } catch {
        // A page that will not load is not an error worth failing the run over.
      }
    }

    const updates: Record<string, unknown> = { enriched_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (email && !prospect.email) updates.email = email;
    if (phone && !prospect.phone) updates.phone = phone;

    const { error: saveError } = await db.from("insurance_prospects").update(updates).eq("id", prospect.id);
    if (saveError) {
      result.errors.push(`${prospect.name}: ${saveError.message}`);
      continue;
    }
    if (email && !prospect.email) {
      result.emailsFound++;
      await activity(prospect.id, "enriched", `Found contact address ${email}`, { email });
    }
    if (phone && !prospect.phone) {
      result.phonesFound++;
      await activity(prospect.id, "enriched", `Found phone number ${phone}`, { phone });
    }

    // Contact details are the only thing that can reveal that two source pages
    // describe one person. This is the moment they first exist.
    if (email || phone) {
      const merged = await mergeIfDuplicate({ ...prospect, email: email || prospect.email, phone: phone || prospect.phone });
      if (merged) result.merged++;
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

export async function qualifyInsuranceProspects(batchSize = 10): Promise<QualifyResult> {
  const db = insuranceDb();
  const result: QualifyResult = { processed: 0, scored: 0, qualified: 0, errors: [] };

  // Reachable records are scored first. A score on a record with no email and
  // no phone changes nothing that can be acted on today, while a scored
  // producer with a phone number is work the owner can pick up this morning.
  const { data: pool, error } = await db
    .from("insurance_prospects")
    .select("id, name, track, state, source, email, phone, score, stage")
    .is("duplicate_of", null)
    .is("score", null)
    .neq("stage", "Do not contact")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    result.errors.push(`Cannot read qualification candidates: ${error.message}`);
    return result;
  }
  const reach = (p: any) => (p.email?.trim() ? 0 : p.phone?.trim() ? 1 : 2);
  const prospects = (pool || []).sort((a, b) => reach(a) - reach(b)).slice(0, Math.min(batchSize, 20));

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
    .is("duplicate_of", null)
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
