import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Overall counts
    const { count: totalLeads } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true });

    const { count: leadsWithEmail } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("email", "is", null)
      .neq("email", "");

    const { count: leadsWithPhone } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("phone", "is", null);

    const { count: leadsWithOwner } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("owner_name", "is", null);

    const { count: leadsScored } = await supabase
      .from("lead_ai_summaries")
      .select("*", { count: "exact", head: true });

    const { count: leadsHighScore } = await supabase
      .from("lead_ai_summaries")
      .select("*", { count: "exact", head: true })
      .gt("lead_score", 50);

    // Email sending stats
    const { count: emailsSentToday } = await supabase
      .from("outreach_log")
      .select("*", { count: "exact", head: true })
      .eq("channel", "email")
      .gte("sent_at", `${today}T00:00:00Z`);

    const { count: emailsSentTotal } = await supabase
      .from("outreach_log")
      .select("*", { count: "exact", head: true })
      .eq("channel", "email");

    return NextResponse.json({
      leads: {
        total: totalLeads,
        withEmail: leadsWithEmail,
        emailPercentage: totalLeads ? Math.round((leadsWithEmail! / totalLeads) * 100) : 0,
        withPhone: leadsWithPhone,
        withOwner: leadsWithOwner,
      },
      scoring: {
        scored: leadsScored,
        highQuality: leadsHighScore,
        readyForOutreach: leadsHighScore,
      },
      email: {
        sentToday: emailsSentToday || 0,
        sentTotal: emailsSentTotal || 0,
        dailyCapacity: 25,
        remainingToday: Math.max(0, 25 - (emailsSentToday || 0)),
      },
      summary: {
        readyToSend: leadsHighScore,
        needsEmail: totalLeads! - (leadsWithEmail || 0),
        needsScoring: (leadsWithEmail || 0) - (leadsScored || 0),
      },
    });
  } catch (error) {
    console.error("Status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status check failed" },
      { status: 500 }
    );
  }
}
