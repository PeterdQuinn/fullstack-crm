import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/ai-scoring";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 300;

async function scrapeLeadData(lead: any) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        website: lead.website || undefined,
        business_name: lead.business_name,
        city: lead.city || "",
      }),
    });
    return await res.json();
  } catch (error) {
    console.error(`Scrape failed for ${lead.business_name}:`, error);
    return {};
  }
}


export async function GET(req: NextRequest) {
  // Verify cron secret (required for security)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET not set - cron jobs disabled for security");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("🔄 Starting discovered leads processor...");

    // Get new leads that haven't been processed
    const { data: newLeads } = await supabase
      .from("leads")
      .select("*")
      .eq("status", "New")
      .is("lead_ai_summaries", null)
      .limit(10);

    if (!newLeads || newLeads.length === 0) {
      console.log("No new leads to process");
      return NextResponse.json({
        success: true,
        processed: 0,
        message: "No new leads to process",
      });
    }

    console.log(`Processing ${newLeads.length} new leads...`);

    let scraped = 0;
    let scored = 0;
    let failed = 0;

    for (const lead of newLeads) {
      try {
        // Step 1: Scrape for missing data
        if (lead.website && (!lead.email || !lead.phone || !lead.owner_name)) {
          console.log(`Scraping ${lead.business_name}...`);
          const scrapedData = await scrapeLeadData(lead);

          if (scrapedData.email || scrapedData.phone || scrapedData.owner) {
            const updates: any = {};
            if (scrapedData.email && !lead.email) updates.email = scrapedData.email;
            if (scrapedData.phone && !lead.phone) updates.phone = scrapedData.phone;
            if (scrapedData.owner && !lead.owner_name) updates.owner_name = scrapedData.owner;

            await supabase.from("leads").update(updates).eq("id", lead.id);
            scraped++;
          }
        }

        // Step 2: Score with AI
        console.log(`Scoring ${lead.business_name}...`);
        const score = await scoreLead({
          business_name: lead.business_name,
          owner_name: lead.owner_name,
          industry: lead.industry,
          current_software: lead.current_software,
          technologies: lead.technologies,
          short_description: lead.short_description,
        });

        if (score) {
          await supabase
            .from("lead_ai_summaries")
            .upsert({
              lead_id: lead.id,
              lead_score: score.lead_score || 50,
              confidence_level: score.confidence_level || "medium",
              main_pain_point: score.main_pain_point,
              best_attack_angle: score.best_attack_angle,
              recommended_first_message: score.recommended_first_message,
              recommended_follow_up: score.recommended_follow_up,
              missing_data_needed: score.missing_data_needed,
            });
          scored++;
        }

        // Step 3: Update lead status based on score
        const leadScore = score?.lead_score || 50;
        const newStatus = leadScore > 60 ? "Ready for Outreach" : "Scored";
        await supabase.from("leads").update({ status: newStatus }).eq("id", lead.id);
      } catch (error) {
        console.error(`Failed to process ${lead.business_name}:`, error);
        failed++;
      }
    }

    console.log(`✅ Processing complete: Scraped ${scraped}, Scored ${scored}, Failed ${failed}`);

    return NextResponse.json({
      success: true,
      processed: newLeads.length,
      scraped,
      scored,
      failed,
      message: `Processed ${newLeads.length} leads: scraped ${scraped}, scored ${scored}`,
    });
  } catch (error) {
    console.error("Processor error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
