import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateLeadSummary } from "@/lib/grok";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, business_name, owner_name, short_description, industry, current_software, monthly_spend_estimate, technologies")
      .neq("email", null)
      .neq("email", "");

    if (leadsError || !leads) {
      return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }

    console.log(`📊 Processing ${leads.length} leads...`);

    const results = { generated: 0, highScore: 0, deleted: 0, errors: 0 };
    const idsToDelete: string[] = [];

    for (const lead of leads) {
      try {
        // Generate summary
        const summary = await generateLeadSummary(lead);
        const score = summary.lead_score || 0;

        // Upsert summary
        await supabase.from("lead_ai_summaries").upsert(
          {
            lead_id: lead.id,
            main_pain_point: summary.main_pain_point,
            pain_reason: summary.pain_reason,
            best_attack_angle: summary.best_attack_angle,
            recommended_first_message: summary.recommended_first_message,
            recommended_follow_up: summary.recommended_follow_up,
            lead_score: score,
            confidence_level: summary.confidence_level,
            missing_data_needed: summary.missing_data_needed,
          },
          { onConflict: "lead_id" }
        );

        results.generated++;

        if (score > 50) {
          results.highScore++;
        } else {
          idsToDelete.push(lead.id);
          console.log(`❌ Deleting ${lead.business_name} (score: ${score})`);
        }

        // Rate limit
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error processing ${lead.business_name}:`, error);
        results.errors++;
      }
    }

    // Delete low-score leads
    if (idsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("leads")
        .delete()
        .in("id", idsToDelete);

      if (deleteError) {
        console.error("Delete error:", deleteError);
      } else {
        results.deleted = idsToDelete.length;
      }
    }

    return NextResponse.json({
      success: true,
      generated: results.generated,
      kept: results.highScore,
      deleted: results.deleted,
      errors: results.errors,
      message: `✅ Generated ${results.generated} scores. Kept ${results.highScore} high-quality leads. Deleted ${results.deleted} low-scorers.`,
    });
  } catch (error) {
    console.error("Bulk score error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk scoring failed" },
      { status: 500 }
    );
  }
}
