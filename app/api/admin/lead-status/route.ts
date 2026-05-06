import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get lead processing summary
    const { data: allLeads } = await supabase
      .from("leads")
      .select("status");

    const statusCounts = allLeads?.reduce((acc: Record<string, number>, lead: { status: string | null }) => {
      const status = lead.status || "Unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}) || {};

    const leads = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

    // Get discovery source distribution
    const { data: allSources } = await supabase
      .from("leads")
      .select("niche");

    const sourceCounts = allSources?.reduce((acc: Record<string, number>, lead: { niche: string | null }) => {
      const niche = lead.niche || "Unknown";
      acc[niche] = (acc[niche] || 0) + 1;
      return acc;
    }, {}) || {};

    const sources = Object.entries(sourceCounts).map(([niche, count]) => ({ niche, count }));

    // Get enrichment status
    const { count: withEmail } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("email", "is", null);

    const { count: withPhone } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("phone", "is", null);

    const { count: withOwner } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("owner_name", "is", null);

    const { data: scores } = await supabase
      .from("lead_ai_summaries")
      .select("lead_id");

    const withScore = new Set(scores?.map(s => s.lead_id) || []).size;

    // Get recent processing logs
    const { data: recentLogs } = await supabase
      .from("outreach_log")
      .select("lead_id, leads(business_name), channel, status, sent_at")
      .order("sent_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      summary: {
        byStatus: leads || [],
        bySource: sources || [],
        enrichment: {
          withEmail,
          withPhone,
          withOwner,
          withScore,
        },
      },
      recentActivity: recentLogs || [],
    });
  } catch (error) {
    console.error("Status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
