import { INSURANCE_STATES, safePublicUrl, type InsuranceSource, type InsuranceState, type InsuranceTrack } from "./types";

type SearchOptions = { track: InsuranceTrack; state: InsuranceState; query: string };
type Provider = "serpapi" | "ollama";
export interface SearchResult { sources: InsuranceSource[]; provider: Provider; query: string; searchedAt: string; warning?: string }
export function insuranceQuery({ track, state, query }: SearchOptions): string {
  const territory = INSURANCE_STATES[state];
  // A query result is evidence to review, not a verified person or purchase intent.
  return track === "recruiting"
    ? `${query || 'life insurance agent producer NPN'} ${territory}`
    : `${query || '"looking for" "life insurance"'} ${territory}`;
}
export function normalizeSources(rows: unknown[]): InsuranceSource[] {
  const seen = new Set<string>();
  const result: InsuranceSource[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const url = safePublicUrl(item.link || item.url || item.website);
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 300) : "";
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const snippet = [item.snippet, item.content, item.description].find(value => typeof value === "string") as string | undefined;
    result.push({ title, url, snippet: (snippet || "").slice(0, 2000), published: typeof item.date === "string" ? item.date.slice(0, 100) : null });
    if (result.length === 10) break;
  }
  return result;
}

export async function searchInsurance(options: SearchOptions, deps: {
  reserve: (provider: Provider) => Promise<boolean>;
  fetch?: typeof fetch;
  serpKey?: string;
  ollamaKey?: string;
}): Promise<SearchResult> {
  const request = deps.fetch || fetch;
  const query = insuranceQuery(options);
  const warnings: string[] = [];
  const providers: Provider[] = [];
  if (deps.ollamaKey) providers.push("ollama");
  if (deps.serpKey) providers.push("serpapi");
  if (!providers.length) throw new Error("Insurance search credentials are not configured");
  for (const provider of providers) {
    if (!await deps.reserve(provider)) { warnings.push(`${provider} monthly search limit reached`); continue; }
    try {
      let response: Response;
      if (provider === "serpapi") {
        const params = new URLSearchParams({ engine: "google", q: query, api_key: deps.serpKey!, num: "10", hl: "en", gl: "us" });
        response = await request(`https://serpapi.com/search.json?${params}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      } else {
        response = await request("https://ollama.com/api/web_search", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.ollamaKey}` },
          body: JSON.stringify({ query, max_results: 10 }), cache: "no-store", signal: AbortSignal.timeout(8000),
        });
      }
      // Never propagate provider bodies or request URLs: they can contain secrets.
      if (!response.ok) { warnings.push(`${provider} returned HTTP ${response.status}`); continue; }
      const payload = await response.json();
      if (payload.error) { warnings.push(`${provider} could not complete this search`); continue; }
      const rows = provider === "serpapi" ? payload.organic_results : payload.results;
      if (rows != null && !Array.isArray(rows)) { warnings.push(`${provider} returned an invalid result`); continue; }
      return { sources: normalizeSources(rows || []), provider, query, searchedAt: new Date().toISOString(), ...(warnings.length ? { warning: warnings.join("; ") } : {}) };
    } catch { warnings.push(`${provider} timed out or could not be reached`); }
  }
  throw new Error(warnings.join("; ") || "Insurance search is unavailable");
}
