import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateLeadSummary } from "@/lib/grok";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json();

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, business_name, owner_name, short_description, industry, current_software, monthly_spend_estimate, technologies")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const summary = await generateLeadSummary(lead);

    const { error: upsertError } = await supabase
      .from("lead_ai_summaries")
      .upsert({
        lead_id: leadId,
        main_pain_point: summary.main_pain_point,
        pain_reason: summary.pain_reason,
        best_attack_angle: summary.best_attack_angle,
        recommended_first_message: summary.recommended_first_message,
        recommended_follow_up: summary.recommended_follow_up,
        lead_score: summary.lead_score,
        confidence_level: summary.confidence_level,
        missing_data_needed: summary.missing_data_needed,
      }, { onConflict: "lead_id" });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("Summarize error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate summary" },
      { status: 500 }
    );
  }
}
