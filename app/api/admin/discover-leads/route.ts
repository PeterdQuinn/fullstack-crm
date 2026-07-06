import { NextRequest, NextResponse } from "next/server";
import {
  DiscoveredLead,
  filterNewLeads,
  importLeads,
} from "@/lib/lead-discovery";
import {
  INDUSTRIES,
  MAJOR_CITIES_BY_STATE,
  searchGooglePlaces,
  searchOverpass,
} from "@/lib/discovery-sources";
import { cleanAndStructureLeads, RawLead } from "@/lib/discovery-clean";
import { getGoogleQuota } from "@/lib/api-usage";
import { getNextStates } from "@/lib/state-rotation";

export const maxDuration = 120;

// Real lead discovery: Google Places (weekly-capped) + OpenStreetMap Overpass
// (free), combined, AI-cleaned (Ollama), then imported. Everything runs
// in-process — no self-HTTP calls — so Basic Auth on /api/admin never blocks it.
export async function POST(req: NextRequest) {
  try {
    const {
      states = 1,
      limit = 30,
      city,
      state,
      niche,
      importToDb = true,
    } = await req.json().catch(() => ({}));

    // Target locations: explicit city/state overrides state rotation.
    let targets: { city: string; state: string }[] = [];
    if (city && state) {
      targets = [{ city, state }];
    } else {
      const statesToSearch = await getNextStates(states);
      for (const st of statesToSearch) {
        const cities = (MAJOR_CITIES_BY_STATE[st] || [st]).slice(0, 2);
        for (const c of cities) targets.push({ city: c, state: st });
      }
    }

    const industries = niche && niche !== "all"
      ? INDUSTRIES.filter((i) => i.niche.toLowerCase() === String(niche).toLowerCase())
      : INDUSTRIES;

    // ── PHASE 1: gather from both sources (in-process) ──
    const rawGoogle: RawLead[] = [];
    const rawOverpass: RawLead[] = [];

    for (const { city: c, state: st } of targets) {
      for (const ind of industries) {
        if (rawGoogle.length + rawOverpass.length >= limit * 2) break;

        const g = await searchGooglePlaces({ term: ind.term, niche: ind.niche, city: c, state: st });
        rawGoogle.push(...g.map((l: DiscoveredLead) => ({ ...l, source: "google_places" })));

        const o = await searchOverpass({ osmFilters: ind.osm, niche: ind.niche, city: c, state: st, limit: 25 });
        rawOverpass.push(...o.map((l: DiscoveredLead) => ({ ...l, source: "overpass" })));

        await new Promise((r) => setTimeout(r, 300)); // be polite to Overpass
      }
    }

    const combined = [...rawGoogle, ...rawOverpass];

    // ── PHASE 2: AI cleanup (dedupe / gap-fill / discard junk) ──
    const clean = await cleanAndStructureLeads(combined);

    // ── PHASE 3: drop leads already in the DB ──
    const newLeads = await filterNewLeads(clean.cleaned);

    // ── PHASE 4: import survivors ──
    let importResult = { imported: 0, skipped: 0, errors: 0, importedIds: [] as string[] };
    if (importToDb && newLeads.length > 0) {
      importResult = await importLeads(newLeads);
    }

    const quota = await getGoogleQuota();

    return NextResponse.json({
      success: true,
      pipeline: {
        discovered: combined.length,
        cleaned: clean.cleaned.length,
        dropped: clean.dropped.length,
        merged: clean.merged.length,
        newLeads: newLeads.length,
        imported: importResult.imported,
      },
      sources: {
        google_places: rawGoogle.length,
        overpass: rawOverpass.length,
        google_quota: quota,
      },
      ai: {
        used: clean.aiUsed,
        error: clean.aiError || null,
        dropped: clean.dropped,
        merged: clean.merged,
      },
      targets,
      importedLeadIds: importResult.importedIds,
      message: `Discovered ${combined.length} raw (${rawGoogle.length} Google / ${rawOverpass.length} Overpass), cleaned to ${clean.cleaned.length}, imported ${importResult.imported}.`,
    });
  } catch (error) {
    console.error("Discovery pipeline error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 }
    );
  }
}
