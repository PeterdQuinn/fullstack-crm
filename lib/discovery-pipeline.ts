import { DiscoveredLead, filterNewLeads, importLeads } from "@/lib/lead-discovery";
import {
  HVAC_SEARCH_TERMS,
  HVAC_OSM_FILTERS,
  HVAC_NICHE,
  googleTextQuery,
  buildOverpassQuery,
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
}

export async function runDiscoveryPipeline(options: DiscoveryOptions = {}) {
  const { states = 1, city, state, importToDb = true } = options;
  const targets = city && state
    ? [{ city, state }]
    : await getNextMetros(Math.max(2, states));

  const rawGoogle: RawLead[] = [];
  const rawOverpass: RawLead[] = [];
  const queriesSent: { source: string; query: string }[] = [];
  const MAX_RAW = 60;
  const PER_CITY = 15;

  for (const { city: targetCity, state: targetState } of targets) {
    if (rawGoogle.length + rawOverpass.length >= MAX_RAW) break;

    queriesSent.push({
      source: "overpass",
      query: buildOverpassQuery(HVAC_OSM_FILTERS, targetCity, PER_CITY),
    });
    const overpassPromise = searchOverpass({
      osmFilters: HVAC_OSM_FILTERS,
      niche: HVAC_NICHE,
      city: targetCity,
      state: targetState,
      limit: PER_CITY,
    });

    for (const term of HVAC_SEARCH_TERMS) {
      queriesSent.push({ source: "google_places", query: googleTextQuery(term, targetCity, targetState) });
      const found = await searchGooglePlaces({
        term,
        niche: HVAC_NICHE,
        city: targetCity,
        state: targetState,
      });
      rawGoogle.push(...found.map((lead: DiscoveredLead) => ({ ...lead, source: "google_places" })));
    }

    const overpass = await overpassPromise;
    rawOverpass.push(...overpass.map((lead: DiscoveredLead) => ({ ...lead, source: "overpass" })));
  }

  const combined = [...rawGoogle, ...rawOverpass];
  const clean = await cleanAndStructureLeads(combined);
  const newLeads = await filterNewLeads(clean.cleaned);
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
      dropped: clean.dropped.length,
      merged: clean.merged.length,
      newLeads: newLeads.length,
      imported: imported.imported,
    },
    sources: { google_places: rawGoogle.length, overpass: rawOverpass.length, google_quota: quota },
    ai: { used: clean.aiUsed, error: clean.aiError || null, dropped: clean.dropped, merged: clean.merged },
    targets,
    importedLeadIds: imported.importedIds,
    message: `HVAC discovery — ${combined.length} raw (${rawGoogle.length} Google / ${rawOverpass.length} Overpass), cleaned to ${clean.cleaned.length}, imported ${imported.imported}.`,
  };
}
