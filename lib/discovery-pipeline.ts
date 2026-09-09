import { DiscoveredLead, filterNewLeads, importLeads } from "@/lib/lead-discovery";
import {
  googleTextQuery,
  buildOverpassQuery,
  buildOverpassRadiusQuery,
  geocodeSearchArea,
  searchGooglePlaces,
  searchOverpass,
} from "@/lib/discovery-sources";
import { cleanAndStructureLeads, RawLead } from "@/lib/discovery-clean";
import { getGoogleQuota } from "@/lib/api-usage";
import { createClient } from "@supabase/supabase-js";
import { discoveryTerms, DEFAULT_LOCATIONS } from "@/lib/targeting";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export interface DiscoveryOptions {
  states?: number;
  niche?: string;
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
  let target = { city: city || "", state: state || "", niche: options.niche || "" };
  if (!city || !state) {
    const { data, error } = await db.rpc("next_discovery_target", { p_locations: DEFAULT_LOCATIONS });
    if (error) throw new Error(`Could not save target rotation: ${error.message}`);
    target = data;
  }
  const { niche, terms, osmFilters } = discoveryTerms(target.niche || "HVAC");
  const targets = [{ city: target.city, state: target.state }];

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
    if (osmFilters.length) queriesSent.push({
      source: "overpass",
      query: coordinates
        ? buildOverpassRadiusQuery(osmFilters, coordinates.latitude, coordinates.longitude, radiusMeters, PER_CITY)
        : buildOverpassQuery(osmFilters, targetCity, PER_CITY),
    });
    const overpassPromise = osmFilters.length ? searchOverpass({
      osmFilters: osmFilters,
      niche: niche,
      city: targetCity,
      state: targetState,
      limit: PER_CITY,
      ...(coordinates || {}),
      radiusMeters: coordinates ? radiusMeters : undefined,
      onError: noteSourceError,
    }) : Promise.resolve([]);

    for (const term of terms) {
      queriesSent.push({ source: "google_places", query: googleTextQuery(term, targetCity, targetState) });
      const found = await searchGooglePlaces({
        term,
        niche: niche,
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
  if (!combined.length && sourceErrors.size) throw new Error(`Discovery sources unavailable: ${[...sourceErrors].join("; ")}`);
  const clean = await cleanAndStructureLeads(combined);
  const qualified = clean.cleaned.filter((lead) => {
    if (options.requireEmail && !lead.email) return false;
    if (options.requirePhone && !lead.phone) return false;
    if (options.requireWebsite && !lead.website) return false;
    if (options.minimumRating && (!lead.rating || lead.rating < options.minimumRating)) return false;
    if (options.minimumReviews && (!lead.review_count || lead.review_count < options.minimumReviews)) return false;
    return true;
  });
  const newLeads = (await filterNewLeads(qualified)).slice(0, requestedLimit);
  let imported = { imported: 0, skipped: 0, errors: 0, importedIds: [] as string[] };
  if (importToDb && newLeads.length > 0) imported = await importLeads(newLeads);
  if (imported.errors > 0) throw new Error(`Discovery import failed for ${imported.errors} lead(s)`);

  const quota = await getGoogleQuota();
  return {
    success: true,
    niche: niche,
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
    message: `${niche} discovery — ${combined.length} raw (${rawGoogle.length} Google / ${rawOverpass.length} Overpass), cleaned to ${clean.cleaned.length}, imported ${imported.imported}.`,
  };
}
