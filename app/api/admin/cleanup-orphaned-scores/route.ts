import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  try {
    console.log("🧹 Starting cleanup of orphaned scoring records...");

    // Get all lead IDs that exist
    const { data: existingLeads } = await supabase
      .from("leads")
      .select("id");

    const existingLeadIds = new Set(existingLeads?.map((l) => l.id) || []);

    // Get all scoring records
    const { data: allScores } = await supabase
      .from("lead_ai_summaries")
      .select("lead_id");

    // Find orphaned ones (scoring records with no matching lead)
    const orphanedIds = (allScores || [])
      .map((s) => s.lead_id)
      .filter((id) => !existingLeadIds.has(id));

    console.log(`Found ${orphanedIds.length} orphaned scoring records`);

    // Delete orphaned records in batches
    let deleted = 0;
    for (let i = 0; i < orphanedIds.length; i += 100) {
      const batch = orphanedIds.slice(i, i + 100);
      const { error } = await supabase
        .from("lead_ai_summaries")
        .delete()
        .in("lead_id", batch);

      if (error) {
        console.error("Delete error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      deleted += batch.length;
    }

    console.log(`✅ Deleted ${deleted} orphaned records`);

    // Get updated stats
    const { count: totalLeads } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true });

    const { count: leadsWithEmail } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("email", "is", null)
      .neq("email", "");

    const { count: leadsScored } = await supabase
      .from("lead_ai_summaries")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      success: true,
      cleaned: deleted,
      stats: {
        totalLeads,
        withEmail: leadsWithEmail,
        scored: leadsScored,
        needsScoring: Math.max(0, (leadsWithEmail || 0) - (leadsScored || 0)),
      },
      message: `Cleaned ${deleted} orphaned records. Stats now show ${(leadsWithEmail || 0) - (leadsScored || 0)} leads needing scoring.`,
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed" },
      { status: 500 }
    );
  }
}
