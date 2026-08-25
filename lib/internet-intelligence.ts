export type InternetSignalCategory =
  | "reputation" | "hiring" | "expansion" | "advertising"
  | "technology" | "licensing" | "bbb" | "public_records" | "social" | "news" | "website";

export interface InternetObservation {
  category: InternetSignalCategory;
  signal: string;
  value: string;
  numericValue?: number;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  confidence: "high" | "medium" | "low";
  growthDirection: -1 | 0 | 1;
  identityScore?: number;
  matchReasons?: string[];
  evidenceType?: "verified" | "single_source";
  publishedAt?: string;
  corroborationCount?: number;
}

export interface InternetIntelligence {
  footprintScore: number;
  momentumScore: number;
  momentumLabel: "contracting" | "quiet" | "established" | "growing" | "scaling";
  summary: string;
  observations: InternetObservation[];
  creditsUsed: number;
  provider: "firecrawl" | "deterministic";
  warning?: string;
}

type LeadIdentity = {
  business_name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  google_rating?: number | string | null;
  google_review_count?: number | string | null;
  technologies?: string | null;
  address?: string | null;
  owner_name?: string | null;
};

type FirecrawlResult = { title?: string; description?: string; url?: string; markdown?: string };

const POSITIVE = /\b(hiring|join our team|now hiring|opened|opening|new location|expanding|expansion|growing|growth|serving more|acquired|acquisition|award|fastest.growing)\b/i;
const NEGATIVE = /\b(closed|closing|bankruptcy|revoked|suspended|expired|layoff|downsizing|out of business)\b/i;
const ADVERTISING = /\b(ad library|sponsored|google ads|meta pixel|facebook pixel|callrail|campaign|advertis(?:e|ing))\b/i;
const TECHNOLOGY = /\b(servicetitan|housecall pro|jobber|fieldedge|callrail|online booking|schedule online|live chat|financing)\b/i;
const HIRING = /\b(hiring|jobs?|careers?|technician|installer|dispatcher|comfort advisor|sales representative)\b/i;
const EXPANSION = /\b(new location|opened|opening|expanding|expansion|now serving|second location|branch)\b/i;
const SIGNAL_PATTERNS: Array<{ category: InternetSignalCategory; signal: string; pattern: RegExp; direction: -1 | 0 | 1 }> = [
  { category: "hiring", signal: "Hiring activity", pattern: HIRING, direction: 1 },
  { category: "expansion", signal: "Expansion activity", pattern: EXPANSION, direction: 1 },
  { category: "advertising", signal: "Advertising activity", pattern: ADVERTISING, direction: 1 },
  { category: "technology", signal: "Operational technology", pattern: TECHNOLOGY, direction: 1 },
  { category: "bbb", signal: "BBB profile", pattern: /\bBBB\b|Better Business Bureau/i, direction: 0 },
  { category: "licensing", signal: "Contractor license", pattern: /\b(?:contractor )?licen[cs]e(?:d| number| no\.?| #)?\b/i, direction: 0 },
  { category: "public_records", signal: "Public business record", pattern: /\bpermit|business registration|UCC|fleet|registrar of contractors\b/i, direction: 0 },
  { category: "reputation", signal: "Reputation evidence", pattern: /\breviews?|rating|complaints?\b/i, direction: 0 },
];

function keys(): string[] {
  return [process.env.FIRECRAWL_API_KEY, process.env.FIRE_CRAWL_API_KEY, process.env.FIRECRAWL_API_KEYS, process.env.FIRECRAWL_KEY]
    .flatMap((value) => String(value || "").split(/[\s,]+/))
    .map((value) => value.trim()).filter(Boolean);
}

export function isFirecrawlConfigured(): boolean { return keys().length > 0; }

async function firecrawl(path: string, body: Record<string, unknown>) {
  const available = keys();
  let lastError = "Firecrawl is not configured";
  for (const key of available) {
    try {
      const response = await fetch(`https://api.firecrawl.dev/v2/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success !== false) return payload;
      lastError = `Firecrawl ${response.status}: ${payload.error || "request failed"}`;
      if (response.status !== 401 && response.status !== 402 && response.status !== 429) break;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  }
  throw new Error(lastError);
}

function host(website?: string | null): string {
  try { return new URL(/^https?:\/\//i.test(website || "") ? website! : `https://${website}`).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

const normalized = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const phoneDigits = (value: unknown) => String(value || "").replace(/\D/g, "").slice(-10);

export function identityMatch(lead: LeadIdentity, result: FirecrawlResult) {
  const content = `${result.title || ""} ${result.description || ""} ${result.markdown || ""}`.toLowerCase();
  const resultHost = host(result.url);
  const leadHost = host(lead.website);
  let score = 0;
  const reasons: string[] = [];
  if (leadHost && resultHost && (resultHost === leadHost || resultHost.endsWith(`.${leadHost}`))) { score += 100; reasons.push("company domain"); }
  const business = normalized(lead.business_name);
  if (business.length >= 5 && normalized(content).includes(business)) { score += 40; reasons.push("business name"); }
  const phone = phoneDigits(lead.phone);
  if (phone.length === 10 && phoneDigits(content).includes(phone)) { score += 45; reasons.push("phone"); }
  const city = String(lead.city || "").trim().toLowerCase();
  if (city.length >= 3 && content.includes(city)) { score += 20; reasons.push("city"); }
  const state = String(lead.state || "").trim().toLowerCase();
  if (state.length >= 2 && new RegExp(`\\b${state.replace(/[^a-z]/g, "")}\\b`, "i").test(content)) { score += 8; reasons.push("state"); }
  const owner = normalized(lead.owner_name);
  if (owner.length >= 5 && normalized(content).includes(owner)) { score += 25; reasons.push("owner"); }
  const street = String(lead.address || "").split(",")[0].trim().toLowerCase();
  if (/\d/.test(street) && street.length >= 6 && content.includes(street)) { score += 35; reasons.push("address"); }
  return { score: Math.min(100, score), reasons, accepted: score >= 40 || Boolean(leadHost && resultHost === leadHost) };
}

function publishedDate(text: string): string | undefined {
  const match = text.match(/\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),?\s+(20\d{2})\b/i);
  if (!match) return undefined;
  const parsed = new Date(match[0]);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function evidenceSentences(text: string, pattern: RegExp): string[] {
  return text.replace(/[#*_`>|]/g, " ").split(/(?<=[.!?])\s+|\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length >= 20 && line.length <= 500 && pattern.test(line)).slice(0, 2);
}

function categoryFor(text: string, url: string): InternetSignalCategory {
  if (/bbb\.org/i.test(url)) return "bbb";
  if (/permit|ucc|fleet|\.gov|secretary.of.state|business.entity/i.test(`${text} ${url}`)) return "public_records";
  if (/license|contractor|registrar|roc\.|\.gov/i.test(`${text} ${url}`)) return "licensing";
  if (/facebook\.com|instagram\.com|youtube\.com|tiktok\.com/i.test(url)) return "social";
  if (HIRING.test(text) || /indeed|ziprecruiter|glassdoor|linkedin\.com\/jobs/i.test(url)) return "hiring";
  if (EXPANSION.test(text)) return "expansion";
  if (ADVERTISING.test(text)) return "advertising";
  if (TECHNOLOGY.test(text)) return "technology";
  if (/review|rating|complaint|yelp/i.test(`${text} ${url}`)) return "reputation";
  return "news";
}

function observationsFromPage(lead: LeadIdentity, result: FirecrawlResult, observedAt: string): InternetObservation[] {
  if (!result.url) return [];
  const content = `${result.title || ""}. ${result.description || ""} ${result.markdown || ""}`.replace(/\s+/g, " ").trim();
  if (!content) return [];
  const identity = identityMatch(lead, result);
  if (!identity.accepted) return [];
  const source = (() => { try { return new URL(result.url!).hostname.replace(/^www\./, ""); } catch { return "Web result"; } })();
  const authoritative = /bbb\.org|\.gov(?:\/|$)/i.test(result.url) || host(result.url) === host(lead.website);
  const found: InternetObservation[] = [];
  for (const spec of SIGNAL_PATTERNS) for (const sentence of evidenceSentences(content, spec.pattern)) found.push({
    category: spec.category, signal: spec.signal, value: sentence, sourceLabel: source,
    sourceUrl: result.url, observedAt, publishedAt: publishedDate(sentence),
    confidence: authoritative ? "high" : "medium", growthDirection: NEGATIVE.test(sentence) ? -1 : spec.direction,
    identityScore: identity.score, matchReasons: identity.reasons,
    evidenceType: authoritative ? "verified" : "single_source", corroborationCount: 1,
  });
  if (!found.length) found.push({ category: categoryFor(content, result.url), signal: result.title || "Internet mention", value: (result.description || result.markdown || result.title || "").slice(0, 600), sourceLabel: source, sourceUrl: result.url, observedAt, publishedAt: publishedDate(content), confidence: authoritative ? "high" : "medium", growthDirection: NEGATIVE.test(content) ? -1 : POSITIVE.test(content) ? 1 : 0, identityScore: identity.score, matchReasons: identity.reasons, evidenceType: authoritative ? "verified" : "single_source", corroborationCount: 1 });
  return found;
}

export function corroborateObservations(items: InternetObservation[]): InternetObservation[] {
  const sourcesBySignal = new Map<string, Set<string>>();
  for (const item of items) {
    const key = `${item.category}:${normalized(item.signal)}`;
    const sources = sourcesBySignal.get(key) || new Set<string>(); sources.add(host(item.sourceUrl)); sourcesBySignal.set(key, sources);
  }
  return items.map((item) => { const count = sourcesBySignal.get(`${item.category}:${normalized(item.signal)}`)?.size || 1; return { ...item, corroborationCount: count, evidenceType: count >= 2 || item.confidence === "high" ? "verified" : "single_source", confidence: count >= 2 ? "high" : item.confidence }; });
}

export function buildCallPreparation(lead: LeadIdentity, observations: InternetObservation[], momentumLabel?: string) {
  const verified = observations.filter((item) => item.evidenceType === "verified").sort((a, b) => (b.identityScore || 0) - (a.identityScore || 0));
  const leadSignal = verified.find((item) => item.growthDirection > 0) || verified[0];
  const detail = leadSignal?.value;
  const questions = [
    observations.some((item) => item.category === "hiring") ? "As you add people, which part of scheduling or follow-up is becoming hardest to keep consistent?" : "What part of scheduling, dispatch, estimates, or follow-up takes the most manual work?",
    observations.some((item) => item.category === "expansion") ? "What process will become the bottleneck as the company expands?" : "If call volume increased next month, what process would break first?",
    observations.some((item) => item.category === "technology") ? "Which systems does the team enter the same customer information into more than once?" : "What software runs the operation today, and where are the gaps between those tools?",
  ];
  return { momentumLabel: momentumLabel || "unknown", verifiedSignals: verified.slice(0, 5), opener: detail ? `I was researching ${lead.business_name} and found that ${detail.replace(/[.!]+$/, "")}. How is that affecting the way you handle growth operationally?` : `I was looking at ${lead.business_name} and wanted to understand how you currently handle scheduling, follow-up, and daily operations.`, questions };
}

export function verifiedOutreachDetail(observations: InternetObservation[]): string | undefined {
  return observations.find((item) => item.evidenceType === "verified" && item.growthDirection > 0)?.value || observations.find((item) => item.evidenceType === "verified")?.value;
}

export function scoreInternetIntelligence(observations: InternetObservation[], lead: LeadIdentity, previous: InternetObservation[] = []) {
  const categories = new Set(observations.map((item) => item.category));
  const positive = observations.filter((item) => item.growthDirection === 1).length;
  const negative = observations.filter((item) => item.growthDirection === -1).length;
  const reviewCount = Number(lead.google_review_count || 0);
  const previousReviews = previous.filter((item) => item.signal === "Google review count").sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]?.numericValue;
  const reviewGrowth = previousReviews != null ? reviewCount - previousReviews : 0;
  const footprintScore = Math.max(0, Math.min(100,
    categories.size * 8 + Math.min(20, Math.round(Math.log10(reviewCount + 1) * 8)) +
    (lead.website ? 12 : 0) + (lead.technologies ? 8 : 0) + observations.length));
  const momentumScore = Math.max(-100, Math.min(100,
    positive * 12 - negative * 18 + Math.min(25, Math.max(-25, reviewGrowth)) +
    (categories.has("hiring") ? 12 : 0) + (categories.has("expansion") ? 15 : 0) +
    (categories.has("advertising") ? 7 : 0) + (categories.has("technology") ? 6 : 0)));
  const momentumLabel = momentumScore >= 60 ? "scaling" : momentumScore >= 25 ? "growing" : footprintScore >= 55 ? "established" : momentumScore < 0 ? "contracting" : "quiet";
  return { footprintScore, momentumScore, momentumLabel } as const;
}

export async function researchInternetPresence(lead: LeadIdentity, previous: InternetObservation[] = []): Promise<InternetIntelligence> {
  const observedAt = new Date().toISOString();
  const observations: InternetObservation[] = [];
  const reviewCount = Number(lead.google_review_count || 0);
  if (Number.isFinite(reviewCount) && reviewCount > 0) observations.push({ category: "reputation", signal: "Google review count", value: String(reviewCount), numericValue: reviewCount, sourceLabel: "Google Places", sourceUrl: "https://www.google.com/maps", observedAt, confidence: "high", growthDirection: 0 });
  const domain = host(lead.website);
  if (domain) observations.push({ category: "website", signal: "Company website", value: domain, sourceLabel: "Company website", sourceUrl: `https://${domain}`, observedAt, confidence: "high", growthDirection: 0 });

  if (!isFirecrawlConfigured()) {
    const scores = scoreInternetIntelligence(observations, lead, previous);
    return { ...scores, summary: "Baseline signals recorded; configure FIRECRAWL_API_KEY for broad internet research.", observations, creditsUsed: 0, provider: "deterministic", warning: "Firecrawl API key is not available to this runtime." };
  }

  const identity = `"${lead.business_name}" ${[lead.city, lead.state].filter(Boolean).join(" ")}`;
  const queries = [
    `${identity} (site:bbb.org OR contractor license OR permits OR UCC OR fleet OR business registration OR complaints)`,
    `${identity} (hiring OR careers OR jobs OR technician OR dispatcher)`,
    `${identity} (expanding OR "new location" OR "now serving" OR award OR acquisition OR Facebook OR Instagram OR YouTube)`,
    `${identity} (ads OR advertising OR CallRail OR ServiceTitan OR Jobber OR financing OR "online booking")`,
  ];
  let creditsUsed = 0;
  const settled = await Promise.allSettled(queries.map((query) => firecrawl("search", { query, limit: 5, sources: ["web"], location: [lead.city, lead.state, "United States"].filter(Boolean).join(","), country: "US", timeout: 15_000 })));
  const errors: string[] = [];
  const acceptedPages = new Map<string, FirecrawlResult>();
  for (const item of settled) {
    if (item.status === "rejected") { errors.push(String(item.reason)); continue; }
    creditsUsed += Number(item.value.creditsUsed || 0);
    for (const result of item.value.data?.web || []) {
      if (result.url && identityMatch(lead, result).accepted) acceptedPages.set(result.url, result);
    }
  }
  // Search discovers candidates; full-page scrape supplies the actual evidence.
  const pageResults = await Promise.allSettled([...acceptedPages.values()].slice(0, 5).map(async (candidate) => {
    const scraped = await firecrawl("scrape", { url: candidate.url, formats: ["markdown"], onlyMainContent: true, maxAge: 604800000, timeout: 15_000, removeBase64Images: true, blockAds: true });
    return { ...candidate, markdown: scraped.data?.markdown || candidate.markdown };
  }));
  for (const result of pageResults) {
    if (result.status === "rejected") { errors.push(String(result.reason)); continue; }
    observations.push(...observationsFromPage(lead, result.value, observedAt));
  }
  if (domain) {
    try {
      const mapped = await firecrawl("map", { url: `https://${domain}`, limit: 100, sitemap: "include", includeSubdomains: false, ignoreQueryParameters: true, timeout: 20_000 });
      const links = (mapped.links || []).map((item: string | { url?: string }) => typeof item === "string" ? item : item.url).filter(Boolean);
      observations.push({ category: "website", signal: "Website page count", value: String(links.length), numericValue: links.length, sourceLabel: "Firecrawl site map", sourceUrl: `https://${domain}`, observedAt, confidence: "high", growthDirection: 0 });
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    try {
      const response = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&filter=mimetype:text/html&collapse=digest&limit=2&from=2000`, { signal: AbortSignal.timeout(12_000) });
      const rows = await response.json();
      const captures = Array.isArray(rows) ? rows.slice(1) : [];
      for (const row of captures) if (Array.isArray(row) && /^\d{14}$/.test(row[0])) {
        const timestamp = String(row[0]);
        const iso = `${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}T${timestamp.slice(8,10)}:${timestamp.slice(10,12)}:${timestamp.slice(12,14)}Z`;
        observations.push({ category: "website", signal: "Historical website capture", value: `Website archived on ${iso.slice(0, 10)}`, sourceLabel: "Internet Archive", sourceUrl: `https://web.archive.org/web/${timestamp}/${row[1]}`, observedAt, publishedAt: iso, confidence: "high", growthDirection: 0, identityScore: 100, matchReasons: ["company domain"], evidenceType: "verified", corroborationCount: 1 });
      }
    } catch (error) { errors.push(`Internet Archive: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const unique = corroborateObservations([...new Map(observations.map((item) => [`${item.category}:${item.sourceUrl}:${item.signal}:${item.value}`, item])).values()]);
  const scores = scoreInternetIntelligence(unique, lead, previous);
  const highlights = unique.filter((item) => item.growthDirection !== 0).slice(0, 3).map((item) => item.signal);
  return { ...scores, observations: unique, creditsUsed, provider: "firecrawl", summary: highlights.length ? `${scores.momentumLabel}: ${highlights.join("; ")}` : `${scores.momentumLabel}: ${unique.length} dated internet signals recorded.`, warning: errors.length ? `${errors.length} source searches were unavailable; available evidence was preserved.` : undefined };
}
