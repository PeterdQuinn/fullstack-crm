import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, business_name, owner_name, email, phone, website, status, email_sent_count, industry, niche, lead_ai_summaries(lead_score, confidence_level, recommended_follow_up)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Query error:", error);
      throw error;
    }

    return NextResponse.json({
      leads: leads || [],
      count: leads?.length || 0,
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch leads" },
      { status: 500 }
    );
  }
}
