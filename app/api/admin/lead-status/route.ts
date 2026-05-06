import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get lead processing summary
    const { data: leads } = await supabase
      .from("leads")
      .select("status, COUNT(*) as count")
      .group_by("status");

    // Get discovery source distribution
    const { data: sources } = await supabase
      .from("leads")
      .select("niche, COUNT(*) as count")
      .group_by("niche");

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

    const { count: withScore } = await supabase
      .from("lead_ai_summaries")
      .select("lead_id", { count: "exact", head: true, distinct: true });

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
