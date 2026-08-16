import { createClient } from "@supabase/supabase-js";
import { getChain, runChainJson } from "@/lib/ai-providers";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ScoringResult {
  lead_score: number;
  confidence_level: "low" | "medium" | "high";
  main_pain_point?: string;
  best_attack_angle?: string;
  recommended_first_message?: string;
  recommended_follow_up?: string;
  missing_data_needed?: string[];
  provider?: string;
}

// Chain order for scoring lives in CHAINS.scoring (lib/ai-providers.ts).
//
// NOTE: the automation pipeline (lib/automation.ts) treats provider === "fallback"
// as "not a real judgment — never delete this lead". So a genuine model score is
// tagged with its provider name; only the hardcoded default below is "fallback".

// Every column worth feeding the model. Pulled in one read when a leadId is
// supplied, so the prompt reflects everything enrichment has found rather than
// the six fields the original call sites happened to pass.
const LEAD_SCORING_COLUMNS = [
  "id",
  "business_name",
  "owner_name",
  "contact_name",
  "phone",
  "email",
  "website",
  "address",
  "city",
  "state",
  "niche",
  "industry",
  "employees",
  "employee_count",
  "annual_revenue",
  "founded_year",
  "short_description",
  "technologies",
  "keywords",
  "current_software",
  "monthly_spend_estimate",
  "google_rating",
  "google_review_count",
  "how_they_get_clients",
  "pain_point",
  "linkedin_url",
  "facebook_url",
  "twitter_url",
].join(", ");

export interface LeadScoringInput {
  /** When present, the full lead row + socials are loaded and merged in. */
  id?: string;
  business_name: string;
  owner_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  niche?: string | null;
  industry?: string | null;
  employees?: string | null;
  employee_count?: number | string | null;
  annual_revenue?: string | null;
  founded_year?: string | null;
  short_description?: string | null;
  technologies?: string | null;
  keywords?: string | null;
  current_software?: string | null;
  monthly_spend_estimate?: string | null;
  google_rating?: number | string | null;
  google_review_count?: number | string | null;
  how_they_get_clients?: string | null;
  pain_point?: string | null;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  twitter_url?: string | null;
  /** Social platforms already discovered for this lead (from lead_socials). */
  socials?: string[];
}

const isBlank = (v: unknown) =>
  v === null || v === undefined || String(v).trim() === "" || String(v).trim().toLowerCase() === "null";

/**
 * Load everything known about a lead so the prompt is built from real data.
 *
 * The old call sites passed six fields, five of which are null for a freshly
 * discovered lead, so nearly every prompt read
 * "Owner: Unknown / Industry: Unknown / Description: No description" and the
 * model scored the SPARSITY rather than the business. Discovery already stores
 * phone, website, address, city/state and ratings, and enrichment writes
 * socials — all of that is now in the prompt.
 */
export async function loadLeadForScoring(leadId: string): Promise<LeadScoringInput | null> {
  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_SCORING_COLUMNS)
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn(`loadLeadForScoring(${leadId}) failed: ${error.message}`);
    return null;
  }

  const { data: socialRows } = await supabase
    .from("lead_socials")
    .select("platform")
    .eq("lead_id", leadId);

  return {
    ...(data as unknown as LeadScoringInput),
    socials: (socialRows || []).map((s: { platform: string }) => s.platform).filter(Boolean),
  };
}

/**
 * Render only the fields that actually have values.
 *
 * Nothing is emitted as "Unknown"/"None detected" any more — an absent line
 * simply is not in the prompt. What IS missing is summarized once, at the end,
 * with an explicit instruction not to penalize for it. That separation is the
 * whole fix: absence of data is a confidence signal, not a quality signal.
 */
export function buildScoringPrompt(lead: LeadScoringInput): string {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (!isBlank(value)) lines.push(`${label}: ${String(value).trim()}`);
  };

  add("Business", lead.business_name);
  add("Owner", lead.owner_name);
  add("Contact", lead.contact_name);
  add("Industry", lead.industry || lead.niche);
  add(
    "Location",
    [lead.city, lead.state].filter((v) => !isBlank(v)).join(", ") || lead.address
  );
  add("Phone", lead.phone);
  add("Email", lead.email);
  add("Website", lead.website);
  add("Description", lead.short_description);
  add("Current software", lead.current_software);
  add("Site technologies", lead.technologies);
  add("Keywords", lead.keywords);
  add("Employees", lead.employee_count || lead.employees);
  add("Annual revenue", lead.annual_revenue);
  add("Founded", lead.founded_year);
  add("Estimated monthly software spend", lead.monthly_spend_estimate);
  add("Google rating", lead.google_rating);
  add("Google review count", lead.google_review_count);
  add("How they get clients", lead.how_they_get_clients);
  add("Known pain point", lead.pain_point);
  if (lead.socials && lead.socials.length > 0) add("Social profiles", lead.socials.join(", "));
  else {
    const inline = [lead.linkedin_url, lead.facebook_url, lead.twitter_url].filter((v) => !isBlank(v));
    if (inline.length > 0) add("Social profiles", inline.join(", "));
  }

  // Reachability is the single strongest real signal we hold: a lead we can
  // actually contact is worth more than one we cannot, regardless of how much
  // firmographic detail we happen to have scraped.
  const reach: string[] = [];
  if (!isBlank(lead.phone)) reach.push("phone");
  if (!isBlank(lead.email)) reach.push("email");
  if (!isBlank(lead.website)) reach.push("website");
  const reachLine = reach.length > 0 ? reach.join(" + ") : "none";

  const knownFields = lines.length;

  return `You are scoring an outbound sales lead for Full Stack Services LLC, which builds
custom owned software for US home-service businesses (HVAC, plumbing, landscaping)
to replace recurring SaaS subscriptions.

KNOWN DATA (${knownFields} field${knownFields === 1 ? "" : "s"} on file — every field we hold is listed):
${lines.join("\n")}

Reachable by: ${reachLine}

SCORING RULES — read carefully:
- Score the BUSINESS as a sales prospect, NOT the completeness of this record.
- Do NOT deduct points for fields that are absent above. Missing data is normal
  for freshly discovered leads and is reported separately via confidence_level.
- A reachable, real business in our target industries is a GOOD lead. Anything
  with a working phone or email plus a website should score at least 60.
- Raise the score for: signs of an established operation (reviews, ratings,
  employees, years in business), an identified owner, a known SaaS/field-service
  tool we can displace, and evidence of manual/legacy processes.
- Lower the score only for REAL negatives: out of our target industries, an
  enterprise or national chain too large for us, a franchise/directory listing
  rather than an operating business, or no way to contact them at all.
- Use confidence_level (not lead_score) to express how thin the record is:
  "low" when only a name and one contact channel are known, "high" when the
  business, its size, and its current tooling are all evident.

Return ONLY valid JSON with these fields:
{
  "lead_score": <0-100>,
  "confidence_level": "<low|medium|high>",
  "main_pain_point": "<string>",
  "best_attack_angle": "<string>",
  "recommended_first_message": "<string>",
  "recommended_follow_up": "<string>",
  "missing_data_needed": [<array of strings naming fields that would help>]
}`;
}

export async function scoreLead(leadData: LeadScoringInput): Promise<ScoringResult> {
  // When we have an id, re-read the row so scoring always sees the freshest
  // enrichment (the caller's in-memory copy is frequently pre-enrichment).
  let lead = leadData;
  if (leadData.id) {
    const loaded = await loadLeadForScoring(leadData.id);
    if (loaded) lead = { ...leadData, ...loaded };
  }

  const prompt = buildScoringPrompt(lead);

  console.log(`Scoring ${lead.business_name} with available providers...`);

  const res = await runChainJson<ScoringResult>(getChain("scoring"), prompt, {
    label: "scoring",
    validate: (p) => !!p && typeof p === "object" && p.lead_score !== undefined,
  });

  if (res) {
    console.log(`✅ Scored with ${res.provider}`);
    const raw = Number(res.data.lead_score);
    const lead_score = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 50;
    return { ...res.data, lead_score, provider: res.provider };
  }

  // Safe default when every provider failed — tagged "fallback" so automation
  // never deletes a lead on an uncertain (non-model) score. runChainJson has
  // already logged one error line naming every provider and its reason.
  console.warn("All AI providers failed, using default score");
  return {
    lead_score: 50,
    confidence_level: "low",
    main_pain_point: "Unable to determine",
    best_attack_angle: "Contact directly",
    recommended_first_message: `Hi ${lead.business_name}, we help service businesses grow with custom software.`,
    recommended_follow_up: "Following up on our previous message.",
    missing_data_needed: ["owner_name", "industry", "description"],
    provider: "fallback",
  };
}
