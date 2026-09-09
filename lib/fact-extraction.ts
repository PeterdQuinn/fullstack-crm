import { getChain, runChainJson } from "@/lib/ai-providers";

// Turning scraped pages into one sentence worth putting in a stranger's inbox.
//
// WHY AN LLM: the previous extractor matched sentences by keyword, so a BBB
// page titled "Your liability risk when hiring a contractor" scored as hiring
// evidence, and a Birdeye listing title scored as reputation evidence. Deciding
// whether a sentence states a fact *about this specific business* is a reading
// comprehension problem, not a pattern-matching one.

export const OUTREACH_FACT_SIGNAL = "Outreach fact (LLM verified)";

export type FactCategory = "hiring" | "expansion" | "advertising" | "technology" | "reputation" | "news";

export interface ExtractedFact {
  fact: string;
  sourceUrl: string;
  category: FactCategory;
  growthDirection: -1 | 0 | 1;
  provider: string;
}

const CATEGORIES: FactCategory[] = ["hiring", "expansion", "advertising", "technology", "reputation", "news"];

// Same shape the outreach gate enforces downstream, checked here too so a bad
// extraction is rejected before it is ever stored.
const COMPLETE_SENTENCE = /^[A-Z][^\n]{39,179}[.!?]$/;

export function factLooksUsable(fact: string, businessName: string): boolean {
  const value = (fact || "").trim();
  if (!COMPLETE_SENTENCE.test(value)) return false;
  if (/[A-Z]{6,}/.test(value)) return false;
  // First and second person mean it copied marketing or directory furniture
  // ("We handle each job...", "Here are some links to leave us a review").
  if (/\b(?:we|our|us|you|your)\b/i.test(value)) return false;
  // A fact about the business should be able to name it.
  const token = businessName.split(/\s+/).find((w) => w.length > 3);
  if (token && !value.toLowerCase().includes(token.toLowerCase())) return false;
  return true;
}

function buildPrompt(lead: { business_name: string; city?: string | null; state?: string | null; website?: string | null }, pages: { url: string; markdown?: string }[]): string {
  const sources = pages
    .filter((p) => p.markdown)
    .slice(0, 4)
    .map((p, i) => `SOURCE ${i + 1} — ${p.url}\n${(p.markdown || "").replace(/\s+/g, " ").slice(0, 3000)}`)
    .join("\n\n");

  return `You are reading web pages about a specific US business to find ONE fact worth mentioning in a cold sales email.

THE BUSINESS
Name: ${lead.business_name}
Location: ${[lead.city, lead.state].filter(Boolean).join(", ") || "unknown"}
Website: ${lead.website || "unknown"}

${sources}

TASK
Find one specific, checkable fact about THIS business that a stranger could verify from the sources above.

A fact QUALIFIES only if all of these are true:
- It is about this exact business, not a competitor, a namesake, or the industry in general.
- It states something that happened or is true of the business: hiring for a named role, opening or serving a new location, an award, an acquisition, a named software tool in use, running ads, a specific review count or rating, a specific milestone or year founded.
- It would still read as accurate to the owner.

A fact is DISQUALIFIED if it is any of:
- Marketing or slogan text from the company's own site ("We handle each job with expertise").
- Directory or review-site furniture (listing titles, "leave us a review", "Open - Closes 4:00 p.m.", BBB disclaimers).
- General advice about the industry or about hiring contractors.
- Anything you are inferring rather than reading.

OUTPUT
Return ONLY JSON, no prose:
{"fact": "<one complete third-person sentence, 40-180 characters, naming the business, ending in a period>", "source_url": "<the exact URL it came from>", "category": "hiring|expansion|advertising|technology|reputation|news", "growth_direction": 1|0|-1}

If no fact qualifies, return exactly: {"fact": null}
Returning null is the correct answer far more often than not. Never invent or embellish.`;
}

export async function extractOutreachFact(
  lead: { business_name: string; city?: string | null; state?: string | null; website?: string | null },
  pages: { url: string; markdown?: string }[]
): Promise<ExtractedFact | null> {
  if (!pages.some((p) => p.markdown)) return null;

  const result = await runChainJson<{ fact: string | null; source_url?: string; category?: string; growth_direction?: number }>(
    getChain("extraction"),
    buildPrompt(lead, pages),
    {
      label: "outreach-fact",
      validate: (parsed) => parsed && (parsed.fact === null || typeof parsed.fact === "string"),
    }
  );
  if (!result?.data || !result.data.fact) return null;

  const fact = result.data.fact.trim();
  if (!factLooksUsable(fact, lead.business_name)) {
    console.warn(`[outreach-fact] rejected unusable extraction for ${lead.business_name}: "${fact.slice(0, 80)}"`);
    return null;
  }

  const known = pages.map((p) => p.url);
  const sourceUrl = known.includes(result.data.source_url || "") ? result.data.source_url! : known[0];
  const category = CATEGORIES.includes(result.data.category as FactCategory) ? (result.data.category as FactCategory) : "news";
  const direction = [-1, 0, 1].includes(Number(result.data.growth_direction)) ? (Number(result.data.growth_direction) as -1 | 0 | 1) : 0;

  return { fact, sourceUrl, category, growthDirection: direction, provider: result.provider };
}
