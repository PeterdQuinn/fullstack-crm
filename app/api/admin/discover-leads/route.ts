import { NextRequest, NextResponse } from "next/server";
import {
  DiscoveredLead,
  deduplicateLeads,
  normalizeLead,
  filterNewLeads,
  enrichLeadsEmails,
  importLeads,
} from "@/lib/lead-discovery";
import { getNextStates } from "@/lib/state-rotation";

export async function POST(req: NextRequest) {
  try {
    const {
      states = 1,
      limit = 50,
      enrichEmails = true,
      importToDb = true,
    } = await req.json().catch(() => ({}));

    console.log(`🚀 Starting lead discovery pipeline: ${states} state(s), max ${limit} per state`);

    const discovered: DiscoveredLead[] = [];
    const statesToSearch = await getNextStates(states);

    // PHASE 1: Scrape from all sources
    for (const state of statesToSearch) {
      console.log(`\n📍 Searching ${state}...`);

      try {
        // Google Business
        const googleRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/admin/discover-leads/google`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, limit: Math.ceil(limit / 3) }),
          }
        );
        const googleData = await googleRes.json();
        discovered.push(...(googleData.leads || []));
        console.log(`  ✓ Google: ${googleData.count || 0} leads`);
      } catch (error) {
        console.error(`  ✗ Google failed: ${error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        // Yelp
        const yelpRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/admin/discover-leads/yelp`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, limit: Math.ceil(limit / 3) }),
          }
        );
        const yelpData = await yelpRes.json();
        discovered.push(...(yelpData.leads || []));
        console.log(`  ✓ Yelp: ${yelpData.count || 0} leads`);
      } catch (error) {
        console.error(`  ✗ Yelp failed: ${error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        // Directories
        const dirRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/admin/discover-leads/directories`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, limit: Math.ceil(limit / 3) }),
          }
        );
        const dirData = await dirRes.json();
        discovered.push(...(dirData.leads || []));
        console.log(`  ✓ Directories: ${dirData.count || 0} leads`);
      } catch (error) {
        console.error(`  ✗ Directories failed: ${error}`);
      }
    }

    console.log(`\n📊 PHASE 1: Discovered ${discovered.length} total leads`);

    // PHASE 2: Deduplicate
    const deduplicated = deduplicateLeads(
      discovered.map((lead) => normalizeLead(lead))
    );
    console.log(`📊 PHASE 2: After dedup: ${deduplicated.length} leads`);

    // PHASE 3: Filter existing leads
    const newLeads = await filterNewLeads(deduplicated);
    console.log(`📊 PHASE 3: New to database: ${newLeads.length} leads`);

    // PHASE 4: Enrich with emails
    let enrichedLeads = newLeads;
    if (enrichEmails && newLeads.length > 0) {
      console.log(`\n📧 PHASE 4: Enriching ${newLeads.length} leads with emails...`);
      enrichedLeads = await enrichLeadsEmails(newLeads, 2);

      const withEmail = enrichedLeads.filter((l) => l.email).length;
      console.log(`✓ Found emails for ${withEmail}/${newLeads.length} leads`);
    }

    // PHASE 5: Import to database
    let importResult: { imported: number; skipped: number; errors: number; importedIds: string[] } = { imported: 0, skipped: 0, errors: 0, importedIds: [] };
    if (importToDb && enrichedLeads.length > 0) {
      console.log(`\n💾 PHASE 5: Importing ${enrichedLeads.length} leads to database...`);
      importResult = await importLeads(enrichedLeads);
      console.log(`✓ Imported: ${importResult.imported}, Skipped: ${importResult.skipped}, Errors: ${importResult.errors}`);
    }

    console.log(`\n✅ Discovery pipeline complete!`);

    return NextResponse.json({
      success: true,
      pipeline: {
        discovered: discovered.length,
        deduplicated: deduplicated.length,
        newLeads: newLeads.length,
        enriched: enrichedLeads.filter((l) => l.email).length,
        imported: importResult.imported,
      },
      states: statesToSearch,
      importedLeadIds: importResult.importedIds,
      message: `Discovered ${discovered.length} leads, imported ${importResult.imported} to CRM with emails ready for automation.`,
    });
  } catch (error) {
    console.error("Discovery pipeline error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 }
    );
  }
}
