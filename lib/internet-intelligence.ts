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
};

type FirecrawlResult = { title?: string; description?: string; url?: string; markdown?: string };

const POSITIVE = /\b(hiring|join our team|now hiring|opened|opening|new location|expanding|expansion|growing|growth|serving more|acquired|acquisition|award|fastest.growing)\b/i;
const NEGATIVE = /\b(closed|closing|bankruptcy|revoked|suspended|expired|layoff|downsizing|out of business)\b/i;
const ADVERTISING = /\b(ad library|sponsored|google ads|meta pixel|facebook pixel|callrail|campaign|advertis(?:e|ing))\b/i;
const TECHNOLOGY = /\b(servicetitan|housecall pro|jobber|fieldedge|callrail|online booking|schedule online|live chat|financing)\b/i;
const HIRING = /\b(hiring|jobs?|careers?|technician|installer|dispatcher|comfort advisor|sales representative)\b/i;
const EXPANSION = /\b(new location|opened|opening|expanding|expansion|now serving|second location|branch)\b/i;

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

function observation(result: FirecrawlResult, observedAt: string): InternetObservation | null {
  if (!result.url) return null;
  const content = `${result.title || ""}. ${result.description || ""} ${result.markdown || ""}`.replace(/\s+/g, " ").trim();
  if (!content) return null;
  const direction: -1 | 0 | 1 = NEGATIVE.test(content) ? -1 : POSITIVE.test(content) ? 1 : 0;
  const source = (() => { try { return new URL(result.url!).hostname.replace(/^www\./, ""); } catch { return "Web result"; } })();
  return {
    category: categoryFor(content, result.url), signal: result.title || "Internet mention",
    value: (result.description || result.markdown || result.title || "").slice(0, 600),
    sourceLabel: source, sourceUrl: result.url, observedAt,
    confidence: /bbb\.org|\.gov\//i.test(result.url) ? "high" : "medium", growthDirection: direction,
  };
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
  const settled = await Promise.allSettled(queries.map((query) => firecrawl("search", { query, limit: 5, sources: ["web"], location: [lead.city, lead.state, "United States"].filter(Boolean).join(","), country: "US", timeout: 20_000 })));
  const errors: string[] = [];
  for (const item of settled) {
    if (item.status === "rejected") { errors.push(String(item.reason)); continue; }
    creditsUsed += Number(item.value.creditsUsed || 0);
    for (const result of item.value.data?.web || []) { const found = observation(result, observedAt); if (found) observations.push(found); }
  }
  if (domain) {
    try {
      const mapped = await firecrawl("map", { url: `https://${domain}`, limit: 100, sitemap: "include", includeSubdomains: false, ignoreQueryParameters: true, timeout: 20_000 });
      const links = (mapped.links || []).map((item: string | { url?: string }) => typeof item === "string" ? item : item.url).filter(Boolean);
      observations.push({ category: "website", signal: "Website page count", value: String(links.length), numericValue: links.length, sourceLabel: "Firecrawl site map", sourceUrl: `https://${domain}`, observedAt, confidence: "high", growthDirection: 0 });
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const unique = [...new Map(observations.map((item) => [`${item.category}:${item.sourceUrl}:${item.signal}`, item])).values()];
  const scores = scoreInternetIntelligence(unique, lead, previous);
  const highlights = unique.filter((item) => item.growthDirection !== 0).slice(0, 3).map((item) => item.signal);
  return { ...scores, observations: unique, creditsUsed, provider: "firecrawl", summary: highlights.length ? `${scores.momentumLabel}: ${highlights.join("; ")}` : `${scores.momentumLabel}: ${unique.length} dated internet signals recorded.`, warning: errors.length ? `${errors.length} source searches were unavailable; available evidence was preserved.` : undefined };
}
