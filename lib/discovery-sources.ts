import { DiscoveredLead } from "@/lib/lead-discovery";
import { releaseGoogleRequest, reserveGoogleRequest } from "@/lib/api-usage";

// ── HVAC ONLY ──────────────────────────────────────────────────────────────
// Discovery is locked to HVAC. These are the ONLY Google Places search terms
// used; nothing else is searched.
export const HVAC_SEARCH_TERMS = [
  "HVAC contractor",
  "air conditioning repair",
  "heating and cooling company",
  "AC installation",
] as const;

// Overpass has no free-text search — HVAC businesses are matched by OSM tags.
export const HVAC_OSM_FILTERS = ['"craft"="hvac"', '"shop"="hvac"', '"craft"="air_conditioning"'];

export const HVAC_NICHE = "HVAC";

// The literal text sent to Google Places for a term/location. Exported so the
// exact string can be recorded/verified.
export function googleTextQuery(term: string, city: string, state: string): string {
  return `${term} in ${city}, ${state}`;
}

export async function geocodeSearchArea(city: string, state: string, zip?: string): Promise<{ latitude: number; longitude: number } | null> {
  const query = [city, state, zip, "USA"].filter(Boolean).join(", ");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "fullstack-crm-lead-discovery/1.0 (contact: owner@fullstackservicesllc.net)" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const latitude = Number(data?.[0]?.lat);
    const longitude = Number(data?.[0]?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export const MAJOR_CITIES_BY_STATE: Record<string, string[]> = {
  CA: ["Los Angeles", "San Francisco", "San Diego", "Sacramento", "Fresno"],
  TX: ["Houston", "Dallas", "Austin", "San Antonio", "Fort Worth"],
  FL: ["Miami", "Tampa", "Orlando", "Jacksonville", "Tallahassee"],
  NY: ["New York City", "Buffalo", "Rochester", "Albany", "Syracuse"],
  AZ: ["Phoenix", "Mesa", "Tucson", "Chandler", "Glendale"],
  IL: ["Chicago", "Aurora", "Rockford", "Joliet", "Naperville"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron"],
  GA: ["Atlanta", "Augusta", "Savannah", "Columbus", "Macon"],
  NC: ["Charlotte", "Raleigh", "Greensboro", "Winston-Salem", "Durham"],
};

// Keep only the last 10 digits for a US number, but preserve a readable form
// for display. Returns undefined for clearly-nonsense input.
function cleanPhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length < 10) return raw.trim(); // keep as-is; the cleaner will judge it
  return raw.trim();
}

// ─────────────────────────── Google Places (New) ───────────────────────────
const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// nationalPhoneNumber + websiteUri are Enterprise-tier fields; the rest are Pro.
// Billing is at the highest tier requested (Enterprise: ~$35/1k, 1k free/mo).
const PLACES_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.addressComponents",
  "places.rating",
  "places.userRatingCount",
].join(",");

function pickComponent(components: any[], type: string, short = false): string | undefined {
  const c = (components || []).find((x: any) => (x.types || []).includes(type));
  return c ? (short ? c.shortText : c.longText) : undefined;
}

export async function searchGooglePlaces(opts: {
  term: string;
  niche: string;
  city: string;
  state: string;
  maxResults?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  // Lets the pipeline surface a dead source in the UI instead of silently
  // reporting "0 results found".
  onError?: (message: string) => void;
}): Promise<DiscoveredLead[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    console.warn("GOOGLE_PLACES_API_KEY not set — skipping Google Places source.");
    opts.onError?.("Google Places: GOOGLE_PLACES_API_KEY is not set");
    return [];
  }

  // Real, DB-enforced weekly hard cap. No HTTP call is made if this fails.
  const allowed = await reserveGoogleRequest();
  if (!allowed) {
    console.warn("Google Places weekly cap reached — skipping this request.");
    opts.onError?.("Google Places: weekly request cap reached");
    return [];
  }

  const { term, niche, city, state, maxResults = 20 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: googleTextQuery(term, city, state),
        maxResultCount: Math.min(maxResults, 20),
        regionCode: "US",
        ...(opts.latitude != null && opts.longitude != null && opts.radiusMeters
          ? { locationBias: { circle: { center: { latitude: opts.latitude, longitude: opts.longitude }, radius: Math.min(opts.radiusMeters, 50000) } } }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`Google Places error ${res.status}: ${errText.slice(0, 200)}`);
      let detail = "";
      try { detail = JSON.parse(errText)?.error?.message || ""; } catch { detail = ""; }
      // Credential rejections return no data — do not spend a weekly slot.
      if ([400, 401, 403].includes(res.status)) await releaseGoogleRequest();
      opts.onError?.(`Google Places returned ${res.status}${detail ? `: ${detail}` : ""}`);
      return [];
    }
    const data = await res.json();
    return (data.places || [])
      .map((p: any): DiscoveredLead => ({
        business_name: p.displayName?.text || "",
        phone: cleanPhone(p.nationalPhoneNumber),
        website: p.websiteUri || undefined,
        address: p.formattedAddress || undefined,
        city: pickComponent(p.addressComponents, "locality") || city,
        state: pickComponent(p.addressComponents, "administrative_area_level_1", true) || state,
        niche,
        industry: niche,
        rating: p.rating || undefined,
        review_count: p.userRatingCount || undefined,
      }))
      .filter((l: DiscoveredLead) => l.business_name);
  } catch (error) {
    console.error(`Google Places request failed (${niche}/${city}):`, error);
    await releaseGoogleRequest();
    opts.onError?.(`Google Places request failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────── OpenStreetMap Overpass (free) ──────────────────────
// Fallback order matters: the primary is authoritative, kumi is a full global
// mirror used when it is busy. Regional instances (e.g. overpass.osm.ch) are
// deliberately excluded — they answer 200 with 0 elements for US queries, which
// is indistinguishable from "no businesses here".
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export function buildOverpassQuery(osmFilters: string[], city: string, limit: number): string {
  const selectors = osmFilters
    .flatMap((f) => [`node[${f}](area.a);`, `way[${f}](area.a);`])
    .join("");
  // Restrict to the city's administrative boundary (admin_level 8 = US city).
  return `[out:json][timeout:25];area["name"="${city}"]["admin_level"="8"]->.a;(${selectors});out center tags ${limit};`;
}

export function buildOverpassRadiusQuery(osmFilters: string[], latitude: number, longitude: number, radiusMeters: number, limit: number): string {
  const selectors = osmFilters
    .flatMap((filter) => [`node[${filter}](around:${radiusMeters},${latitude},${longitude});`, `way[${filter}](around:${radiusMeters},${latitude},${longitude});`])
    .join("");
  return `[out:json][timeout:25];(${selectors});out center tags ${limit};`;
}

function overpassAddress(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

export async function searchOverpass(opts: {
  osmFilters: string[];
  niche: string;
  city: string;
  state: string;
  limit?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  onError?: (message: string) => void;
}): Promise<DiscoveredLead[]> {
  const { osmFilters, niche, city, state, limit = 25 } = opts;
  const query = opts.latitude != null && opts.longitude != null && opts.radiusMeters
    ? buildOverpassRadiusQuery(osmFilters, opts.latitude, opts.longitude, opts.radiusMeters, limit)
    : buildOverpassQuery(osmFilters, city, limit);
  // Mirrors are queried in PARALLEL and the first usable answer wins. Run
  // sequentially, one busy server burns the whole time budget and both aborts
  // land after the route has nothing left to return.
  // Overpass answers 429/502/503/504 when it is busy, which happens often and
  // clears in seconds. A single shot per mirror threw all of it away: on
  // 2026-08-24 every public mirror (overpass-api.de, kumi, private.coffee,
  // osm.jp) returned 502/504 simultaneously, and the run reported "results are
  // incomplete" when waiting two seconds would have worked.
  //
  // Retry inside each mirror, bounded by a shared wall-clock budget so a busy
  // server still cannot eat the route's 60s limit (Places runs alongside this
  // and the pipeline still has to clean and import whatever comes back).
  const TOTAL_BUDGET_MS = 30_000;
  const PER_ATTEMPT_MS = 11_000;
  const BACKOFF_MS = [0, 1_500, 4_000];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const TRANSIENT = new Set([429, 502, 503, 504]);

  const once = async (endpoint: string): Promise<DiscoveredLead[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "fullstack-crm-lead-discovery/1.0 (contact: owner@fullstackservicesllc.net)",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(
          `OpenStreetMap returned ${res.status}${TRANSIENT.has(res.status) ? " (server busy)" : ""}`
        );
        (err as Error & { transient?: boolean }).transient = TRANSIENT.has(res.status);
        throw err;
      }
      const data = await res.json();
      return (data.elements || [])
        .map((el: any): DiscoveredLead => {
          const tags: Record<string, string> = el.tags || {};
          return {
            business_name: tags.name || "",
            phone: cleanPhone(tags.phone || tags["contact:phone"]),
            website: tags.website || tags["contact:website"] || undefined,
            address: overpassAddress(tags),
            city: tags["addr:city"] || city,
            state: tags["addr:state"] || state,
            niche,
            industry: niche,
          };
        })
        .filter((l: DiscoveredLead) => l.business_name); // drop unnamed OSM nodes
    } finally {
      clearTimeout(timer);
    }
  };

  /** One mirror, retried while it is only busy and the budget allows. */
  const attempt = async (endpoint: string): Promise<DiscoveredLead[]> => {
    let last: unknown;
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      if (i > 0) {
        // An abort is a timeout, which is the same "busy" signal as a 504.
        const retryable =
          (last as { transient?: boolean } | undefined)?.transient === true ||
          (last as { name?: string } | undefined)?.name === "AbortError";
        if (!retryable) break;
        if (Date.now() + BACKOFF_MS[i] + PER_ATTEMPT_MS > deadline) break;
        await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
      }
      try {
        return await once(endpoint);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  };

  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map(attempt));
  } catch (error) {
    const reasons = error instanceof AggregateError
      ? error.errors.map((e) => (e instanceof Error ? e.message : String(e)))
      : [error instanceof Error ? error.message : "unknown error"];
    console.error(
      `Overpass failed on all ${OVERPASS_ENDPOINTS.length} mirrors after retries (${niche}/${city}):`,
      reasons.join("; ")
    );

    // Distinguish "come back in a minute" from "something is actually wrong".
    // Every mirror being busy at once is common and self-healing; the previous
    // message read like a permanent fault and gave no next step.
    const unique = Array.from(new Set(reasons));
    const allBusy = unique.length > 0 && unique.every((r) => /\(server busy\)|abort/i.test(r));
    opts.onError?.(
      allBusy
        ? `OpenStreetMap is busy on every mirror right now (retried ${BACKOFF_MS.length}x). Google Places results are unaffected — re-run discovery in a minute for the OSM half.`
        : `OpenStreetMap unavailable — ${unique.join("; ") || "all mirrors failed"}`
    );
    return [];
  }
}

