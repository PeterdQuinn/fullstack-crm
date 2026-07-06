import { DiscoveredLead } from "@/lib/lead-discovery";
import { reserveGoogleRequest } from "@/lib/api-usage";

// Target niches. `term` is the Google Places / free-text search phrase; `niche`
// is what we store; `osm` are the OpenStreetMap tag filters for Overpass.
export const INDUSTRIES = [
  { term: "HVAC contractor", niche: "HVAC", osm: ['"craft"="hvac"', '"shop"="hvac"', '"craft"="air_conditioning"'] },
  { term: "Landscaping company", niche: "Landscaping", osm: ['"craft"="gardener"', '"shop"="garden_centre"'] },
  { term: "Plumber", niche: "Plumbing", osm: ['"craft"="plumber"'] },
  { term: "Roofing contractor", niche: "Roofing", osm: ['"craft"="roofer"'] },
];

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
}): Promise<DiscoveredLead[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    console.warn("GOOGLE_PLACES_API_KEY not set — skipping Google Places source.");
    return [];
  }

  // Real, DB-enforced weekly hard cap. No HTTP call is made if this fails.
  const allowed = await reserveGoogleRequest();
  if (!allowed) {
    console.warn("Google Places weekly cap reached — skipping this request.");
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
        textQuery: `${term} in ${city}, ${state}`,
        maxResultCount: Math.min(maxResults, 20),
        regionCode: "US",
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`Google Places error ${res.status}: ${errText.slice(0, 200)}`);
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
      }))
      .filter((l: DiscoveredLead) => l.business_name);
  } catch (error) {
    console.error(`Google Places request failed (${niche}/${city}):`, error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────── OpenStreetMap Overpass (free) ──────────────────────
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

function buildOverpassQuery(osmFilters: string[], city: string, limit: number): string {
  const selectors = osmFilters
    .flatMap((f) => [`node[${f}](area.a);`, `way[${f}](area.a);`])
    .join("");
  // Restrict to the city's administrative boundary (admin_level 8 = US city).
  return `[out:json][timeout:25];area["name"="${city}"]["admin_level"="8"]->.a;(${selectors});out center tags ${limit};`;
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
}): Promise<DiscoveredLead[]> {
  const { osmFilters, niche, city, state, limit = 25 } = opts;
  const query = buildOverpassQuery(osmFilters, city, limit);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "fullstack-crm-lead-discovery/1.0 (contact: owner@fullstackservicesllc.net)",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Overpass error ${res.status} for ${niche}/${city}`);
      return [];
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
  } catch (error) {
    console.error(`Overpass request failed (${niche}/${city}):`, error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
