import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    // Count total leads
    const { count: totalLeads } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true });

    // Count leads with emails
    const { count: leadsWithEmail } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("email", "is", null)
      .neq("email", "");

    // Count leads with summaries
    const { count: leadsWithSummaries } = await supabase
      .from("lead_ai_summaries")
      .select("*", { count: "exact", head: true });

    // Get sample leads with their summaries
    const { data: leadsWithData } = await supabase
      .from("leads")
      .select("id, business_name, email, email_sent_count, status, lead_ai_summaries(lead_score, main_pain_point)")
      .not("email", "is", null)
      .neq("email", "")
      .limit(10);

    // Get sample leads that would qualify for email
    const { data: qualifyingLeads } = await supabase
      .from("leads")
      .select("id, business_name, email, email_sent_count, status, lead_ai_summaries(lead_score)")
      .eq("opt_out", false)
      .eq("bounced", false)
      .eq("complained", false)
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .limit(10);

    // Analyze score distribution
    const { data: scoreData } = await supabase
      .from("lead_ai_summaries")
      .select("lead_score")
      .order("lead_score", { ascending: false })
      .limit(10);

    return NextResponse.json({
      totalLeads,
      leadsWithEmail,
      leadsWithSummaries,
      sampleLeads: leadsWithData,
      qualifyingLeads,
      topScores: scoreData,
    });
  } catch (error) {
    console.error("Debug error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Debug failed" },
      { status: 500 }
    );
  }
}
