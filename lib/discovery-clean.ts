import { DiscoveredLead } from "@/lib/lead-discovery";

// A raw lead as gathered from a source, tagged with where it came from.
export type RawLead = DiscoveredLead & { source: string };

export type CleanResult = {
  cleaned: DiscoveredLead[];
  dropped: { business_name: string; reason: string }[];
  merged: { business_name: string; sources: string[] }[];
  aiUsed: boolean;
  aiError?: string;
};

// ── Deterministic junk detectors (same patterns we found in the old fake data) ──
export function isFakePhone(phone?: string): boolean {
  if (!phone) return false;
  const d = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length < 10) return true; // e.g. "5550302"
  if (/555\d{4}$/.test(d)) return true; // 555-01xx style fake exchange
  if (/^(\d)\1{9}$/.test(d)) return true; // 0000000000 etc.
  return false;
}
export function isJunkEmail(email?: string): boolean {
  if (!email) return false;
  return /duckduckgo|example\.(com|org|net)|error|noreply|no-reply|test@/i.test(email);
}

// Enforce the junk rules regardless of what the AI decided. Nulls out bad
// contact fields, then drops anything with no name or no usable contact/site.
function applyGuard(
  leads: DiscoveredLead[]
): { kept: DiscoveredLead[]; dropped: { business_name: string; reason: string }[] } {
  const kept: DiscoveredLead[] = [];
  const dropped: { business_name: string; reason: string }[] = [];
  for (const l of leads) {
    const lead = { ...l };
    if (isFakePhone(lead.phone)) lead.phone = undefined;
    if (isJunkEmail(lead.email)) lead.email = undefined;
    if (!lead.business_name?.trim()) {
      dropped.push({ business_name: lead.business_name || "(unnamed)", reason: "no business name" });
      continue;
    }
    if (!lead.phone && !lead.website && !lead.email) {
      dropped.push({ business_name: lead.business_name, reason: "no phone, website, or email after junk removal" });
      continue;
    }
    kept.push(lead);
  }
  return { kept, dropped };
}

function extractJson(text: string): any | null {
  // Grab the outermost {...} block and parse it defensively.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Deterministic fallback used if the AI is unavailable or returns unusable
// output: dedupe by normalized name (and shared phone/website), merging fields.
function deterministicMerge(raw: RawLead[]): {
  cleaned: DiscoveredLead[];
  merged: { business_name: string; sources: string[] }[];
} {
  const byKey = new Map<string, { lead: DiscoveredLead; sources: Set<string> }>();
  const norm = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const phoneDigits = (p?: string) => (p ? p.replace(/\D/g, "").slice(-10) : "");

  for (const r of raw) {
    // Match on name+city, or on a shared phone, or shared website host.
    const nameKey = `${norm(r.business_name)}|${norm(r.city)}`;
    const phoneKey = phoneDigits(r.phone);
    let key =
      [...byKey.keys()].find((k) => k === nameKey) ||
      (phoneKey && [...byKey.values()].find((v) => phoneDigits(v.lead.phone) === phoneKey)
        ? `phone:${phoneKey}`
        : "") ||
      nameKey;

    const existing = byKey.get(key) || byKey.get(nameKey);
    if (existing) {
      // Fill gaps: keep first non-empty value across duplicates.
      existing.lead.phone ||= r.phone;
      existing.lead.website ||= r.website;
      existing.lead.email ||= r.email;
      existing.lead.address ||= r.address;
      existing.sources.add(r.source);
    } else {
      byKey.set(nameKey, { lead: { ...r }, sources: new Set([r.source]) });
    }
  }

  const cleaned: DiscoveredLead[] = [];
  const merged: { business_name: string; sources: string[] }[] = [];
  for (const { lead, sources } of byKey.values()) {
    cleaned.push(lead);
    if (sources.size > 1) merged.push({ business_name: lead.business_name, sources: [...sources] });
  }
  return { cleaned, merged };
}

// ── AI cleanup via Ollama (same provider/model as scoring) ──
export async function cleanAndStructureLeads(raw: RawLead[]): Promise<CleanResult> {
  if (raw.length === 0) {
    return { cleaned: [], dropped: [], merged: [], aiUsed: false };
  }

  // Pre-dedup deterministically so the AI gets a much smaller payload — the four
  // Google term queries return heavy overlap on the same businesses. This is the
  // main latency win; the AI still does gap-fill + junk detection on the
  // collapsed set. Capped at 60 to keep the model call fast.
  const input: RawLead[] = (() => {
    const seen = new Map<string, RawLead>();
    for (const r of raw) {
      const key =
        (r.business_name || "").toLowerCase().replace(/[^a-z0-9]/g, "") ||
        (r.phone || "").replace(/\D/g, "").slice(-10);
      const ex = seen.get(key);
      if (ex) {
        ex.phone = ex.phone || r.phone;
        ex.website = ex.website || r.website;
        ex.email = ex.email || r.email;
        ex.address = ex.address || r.address;
      } else {
        seen.set(key, { ...r });
      }
    }
    return [...seen.values()].slice(0, 60);
  })();

  const prompt = `You are cleaning a combined list of business leads gathered from two sources (Google Places and OpenStreetMap Overpass). Some businesses appear in BOTH sources.

Your job:
1. DEDUPE: merge entries that refer to the same real business (same/similar name in the same city, or the same phone number, or the same website domain).
2. GAP-FILL: when merging, combine fields — if one source has the phone and the other has the website, keep BOTH.
3. DISCARD junk: remove anything fake or incomplete — fake phone numbers (e.g. 555-01xx, fewer than 10 digits, all-repeated digits), broken/placeholder emails (duckduckgo.com, example.com, "error", "noreply"), or entries with no name and no usable contact info.

Return ONLY a JSON object, no prose, in exactly this shape:
{
  "cleaned": [ { "business_name": "", "phone": "", "website": "", "email": "", "address": "", "city": "", "state": "", "niche": "" } ],
  "dropped": [ { "business_name": "", "reason": "" } ]
}
Use empty string for unknown fields. Do not invent data.

INPUT (${input.length} businesses):
${JSON.stringify(
  input.map((r) => ({
    business_name: r.business_name,
    phone: r.phone || "",
    website: r.website || "",
    email: r.email || "",
    address: r.address || "",
    city: r.city || "",
    state: r.state || "",
    niche: r.niche || "",
    source: r.source,
  })),
  null,
  0
)}`;

  let aiUsed = false;
  let aiError: string | undefined;
  let aiCleaned: DiscoveredLead[] | null = null;
  let aiDropped: { business_name: string; reason: string }[] = [];

  try {
    if (!process.env.OLLAMA_API_KEY || !process.env.OLLAMA_BASE_URL) {
      throw new Error("OLLAMA_API_KEY / OLLAMA_BASE_URL not configured");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 110000);
    const res = await fetch(`${process.env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({ model: "gpt-oss:120b-cloud", prompt, stream: false }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const parsed = extractJson(data.response || "");
    if (!parsed || !Array.isArray(parsed.cleaned)) throw new Error("AI returned unparseable JSON");

    aiUsed = true;
    aiCleaned = parsed.cleaned.map((c: any): DiscoveredLead => ({
      business_name: (c.business_name || "").trim(),
      phone: c.phone?.trim() || undefined,
      website: c.website?.trim() || undefined,
      email: c.email?.trim() || undefined,
      address: c.address?.trim() || undefined,
      city: c.city?.trim() || undefined,
      state: c.state?.trim() || undefined,
      niche: c.niche?.trim() || "General",
    }));
    aiDropped = Array.isArray(parsed.dropped)
      ? parsed.dropped.map((d: any) => ({
          business_name: d.business_name || "(unnamed)",
          reason: d.reason || "flagged by AI",
        }))
      : [];
  } catch (error) {
    aiError = error instanceof Error ? error.message : String(error);
    console.error("AI cleanup failed, falling back to deterministic merge:", aiError);
  }

  // Use AI output if we got it; otherwise deterministic merge so the pipeline
  // still works. Either way, apply the hard junk guard as a final safety net.
  let mergedReport: { business_name: string; sources: string[] }[] = [];
  let baseCleaned: DiscoveredLead[];
  if (aiCleaned) {
    baseCleaned = aiCleaned;
  } else {
    const det = deterministicMerge(input);
    baseCleaned = det.cleaned;
    mergedReport = det.merged;
  }

  const guarded = applyGuard(baseCleaned);
  return {
    cleaned: guarded.kept,
    dropped: [...aiDropped, ...guarded.dropped],
    merged: mergedReport,
    aiUsed,
    aiError,
  };
}
