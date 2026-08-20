import { DiscoveredLead, filterNewLeads, importLeads } from "@/lib/lead-discovery";
import {
  HVAC_SEARCH_TERMS,
  HVAC_OSM_FILTERS,
  HVAC_NICHE,
  googleTextQuery,
  buildOverpassQuery,
  buildOverpassRadiusQuery,
  geocodeSearchArea,
  searchGooglePlaces,
  searchOverpass,
} from "@/lib/discovery-sources";
import { cleanAndStructureLeads, RawLead } from "@/lib/discovery-clean";
import { getGoogleQuota } from "@/lib/api-usage";
import { getNextMetros } from "@/lib/state-rotation";

export interface DiscoveryOptions {
  states?: number;
  limit?: number;
  city?: string;
  state?: string;
  importToDb?: boolean;
  zip?: string;
  minimumRating?: number;
  minimumReviews?: number;
  requireEmail?: boolean;
  requirePhone?: boolean;
  requireWebsite?: boolean;
  radiusMiles?: number;
}

export async function runDiscoveryPipeline(options: DiscoveryOptions = {}) {
  const { states = 1, city, state, importToDb = true } = options;
  const requestedLimit = Math.max(1, Math.min(Number(options.limit) || 10, 25));
  const targets = city && state
    ? [{ city, state }]
    : await getNextMetros(Math.max(2, states));

  const rawGoogle: RawLead[] = [];
  const rawOverpass: RawLead[] = [];
  const queriesSent: { source: string; query: string }[] = [];
  // A source that 401s or times out otherwise looks identical to "no businesses
  // here", so keep the reasons and hand them back to the caller.
  const sourceErrors = new Set<string>();
  const noteSourceError = (message: string) => sourceErrors.add(message);
  const MAX_RAW = 60;
  const PER_CITY = 15;

  for (const { city: targetCity, state: targetState } of targets) {
    if (rawGoogle.length + rawOverpass.length >= MAX_RAW) break;

    const radiusRequested = Number(options.radiusMiles) > 0;
    const radiusMiles = Math.max(1, Math.min(Number(options.radiusMiles) || 15, 30));
    const coordinates = radiusRequested ? await geocodeSearchArea(targetCity, targetState, options.zip) : null;
    const radiusMeters = Math.round(radiusMiles * 1609.344);
    queriesSent.push({
      source: "overpass",
      query: coordinates
        ? buildOverpassRadiusQuery(HVAC_OSM_FILTERS, coordinates.latitude, coordinates.longitude, radiusMeters, PER_CITY)
        : buildOverpassQuery(HVAC_OSM_FILTERS, targetCity, PER_CITY),
    });
    const overpassPromise = searchOverpass({
      osmFilters: HVAC_OSM_FILTERS,
      niche: HVAC_NICHE,
      city: targetCity,
      state: targetState,
      limit: PER_CITY,
      ...(coordinates || {}),
      radiusMeters: coordinates ? radiusMeters : undefined,
      onError: noteSourceError,
    });

    for (const term of HVAC_SEARCH_TERMS) {
      queriesSent.push({ source: "google_places", query: googleTextQuery(term, targetCity, targetState) });
      const found = await searchGooglePlaces({
        term,
        niche: HVAC_NICHE,
        city: options.zip ? `${targetCity} ${options.zip}` : targetCity,
        state: targetState,
        maxResults: Math.min(requestedLimit, 20),
        ...(coordinates || {}),
        radiusMeters: coordinates ? radiusMeters : undefined,
        onError: noteSourceError,
      });
      rawGoogle.push(...found.map((lead: DiscoveredLead) => ({ ...lead, source: "google_places" })));
    }

    const overpass = await overpassPromise;
    rawOverpass.push(...overpass.map((lead: DiscoveredLead) => ({ ...lead, source: "overpass" })));
  }

  const combined = [...rawGoogle, ...rawOverpass];
  const clean = await cleanAndStructureLeads(combined);
  const qualified = clean.cleaned.filter((lead) => {
    if (options.requireEmail && !lead.email) return false;
    if (options.requirePhone && !lead.phone) return false;
    if (options.requireWebsite && !lead.website) return false;
    if (options.minimumRating && (!lead.rating || lead.rating < options.minimumRating)) return false;
    if (options.minimumReviews && (!lead.review_count || lead.review_count < options.minimumReviews)) return false;
    return true;
  }).slice(0, requestedLimit);
  const newLeads = await filterNewLeads(qualified);
  let imported = { imported: 0, skipped: 0, errors: 0, importedIds: [] as string[] };
  if (importToDb && newLeads.length > 0) imported = await importLeads(newLeads);
  if (imported.errors > 0) throw new Error(`Discovery import failed for ${imported.errors} lead(s)`);

  const quota = await getGoogleQuota();
  return {
    success: true,
    niche: HVAC_NICHE,
    queries: queriesSent,
    pipeline: {
      discovered: combined.length,
      cleaned: clean.cleaned.length,
      qualified: qualified.length,
      dropped: clean.dropped.length,
      merged: clean.merged.length,
      newLeads: newLeads.length,
      imported: imported.imported,
    },
    sources: { google_places: rawGoogle.length, overpass: rawOverpass.length, google_quota: quota },
    sourceErrors: [...sourceErrors],
    ai: { used: clean.aiUsed, error: clean.aiError || null, dropped: clean.dropped, merged: clean.merged },
    targets,
    searchArea: { radiusMiles: Math.max(1, Math.min(Number(options.radiusMiles) || 15, 30)), exactRadiusApplied: queriesSent.some((query) => query.query.includes("around:")) },
    importedLeadIds: imported.importedIds,
    message: `HVAC discovery — ${combined.length} raw (${rawGoogle.length} Google / ${rawOverpass.length} Overpass), cleaned to ${clean.cleaned.length}, imported ${imported.imported}.`,
  };
}
