import { withAutomationRun } from "@/lib/automation-runs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreLead, FALLBACK_PAIN_POINT } from "@/lib/ai-scoring";
import { FALLBACK_SCORE } from "@/lib/score-thresholds";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Hobby caps function execution at 60s regardless of a higher value here —
// declaring 300 did not buy 300, it just hid the ceiling. Batch sizes below
// are tuned to finish inside this window.
export const maxDuration = 60;

async function scrapeLeadData(lead: any) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/scrape-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        website: lead.website || undefined,
        business_name: lead.business_name,
        city: lead.city || "",
        fast: true, // static-only scrape; a headless-browser pass per lead blew the 60s cap
      }),
    });
    return await res.json();
  } catch (error) {
    console.error(`Scrape failed for ${lead.business_name}:`, error);
    return {};
  }
}


async function handleGET(req: NextRequest) {
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

    // Get new leads that haven't been scored yet.
    //
    // `lead_ai_summaries` is a separate TABLE, not a column on `leads`, so the
    // previous `.is("lead_ai_summaries", null)` filter was invalid — PostgREST
    // errored, the ignored error left `newLeads` undefined, and this route
    // silently reported "No new leads to process" on every single run.
    //
    // Same anti-join pattern as the scoring phase in lib/automation.ts: pull the
    // already-scored lead ids first, then over-fetch and filter in JS. Fetching
    // a plain page and filtering would risk a page that is entirely scored,
    // which would no-op forever without ever reaching the unscored backlog.
    // 10 full scrapes + LLM scores could not complete in 60s and the run hung
    // until curl gave up at 300s. Matches SCRAPE_BATCH/SCORE_BATCH in lib/automation.ts.
    const BATCH = 3;

    const { data: scoredRows, error: scoredError } = await supabase
      .from("lead_ai_summaries")
      .select("lead_id");
    if (scoredError) {
      console.error("Failed to load scored lead ids:", scoredError);
      throw scoredError;
    }
    const scoredIds = new Set((scoredRows || []).map((r) => r.lead_id));

    const { data: pool, error: poolError } = await supabase
      .from("leads")
      .select("*")
      .eq("status", "New")
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(BATCH * 40);
    if (poolError) {
      console.error("Failed to load candidate leads:", poolError);
      throw poolError;
    }

    // Leads whose ONLY score is the placeholder written while every provider was
    // down. They are invisible to the anti-join above — they do have a summary
    // row — and the sender excludes an exact 50 as unevaluated, so nothing in
    // the pipeline ever looked at them again.
    //
    // One slot per run is reserved for a placeholder lead THAT HAS AN EMAIL,
    // ahead of the unscored backlog. Those are the only leads in the whole
    // system that a re-score converts straight into a send; behind 45 unscored
    // new leads at three a run they would have waited five days while the
    // sender had nothing to send.
    const placeholderLeads = async (limit: number, mustHaveEmail: boolean) => {
      if (limit <= 0) return [] as any[];
      const { data: placeholders, error: placeholderError } = await supabase
        .from("lead_ai_summaries")
        .select("lead_id")
        .eq("lead_score", FALLBACK_SCORE)
        .eq("main_pain_point", FALLBACK_PAIN_POINT)
        .limit(200);
      if (placeholderError) {
        console.error("Failed to load placeholder scores:", placeholderError);
        throw placeholderError;
      }
      const ids = (placeholders || []).map((row) => row.lead_id);
      if (!ids.length) return [] as any[];

      let query = supabase
        .from("leads")
        .select("*")
        .in("id", ids)
        .is("archived_at", null)
        .eq("opt_out", false)
        .neq("status", "Do Not Contact");
      if (mustHaveEmail) query = query.not("email", "is", null).neq("email", "");
      const { data: stale, error: staleError } = await query
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (staleError) {
        console.error("Failed to load leads holding a placeholder score:", staleError);
        throw staleError;
      }
      return stale || [];
    };

    const mailablePlaceholders = await placeholderLeads(1, true);
    const unscored = (pool || [])
      .filter((l) => !scoredIds.has(l.id))
      .slice(0, BATCH - mailablePlaceholders.length);
    let newLeads = [...mailablePlaceholders, ...unscored];
    // Spare capacity goes to the rest of the placeholder backlog.
    if (newLeads.length < BATCH) {
      const seen = new Set(newLeads.map((l: any) => l.id));
      const rest = await placeholderLeads(BATCH - newLeads.length, false);
      newLeads = [...newLeads, ...rest.filter((l: any) => !seen.has(l.id))];
    }

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

            const { error: saveError } = await supabase.from("leads").update(updates).eq("id", lead.id);
            if (saveError) throw saveError;
            Object.assign(lead, updates);
            scraped++;
          }
        }

        // Step 2: Score with AI
        console.log(`Scoring ${lead.business_name}...`);
        const score = await scoreLead({
          id: lead.id,
          business_name: lead.business_name,
          owner_name: lead.owner_name,
          industry: lead.industry,
          current_software: lead.current_software,
          technologies: lead.technologies,
          short_description: lead.short_description,
        });

        if (!score || score.provider === "fallback") throw new Error("AI scoring unavailable; lead retained for retry");
        const { error: saveError } = await supabase.rpc("save_automation_score", { p_lead_id: lead.id, p_score: score });
        if (saveError) throw saveError;
        scored++;
      } catch (error) {
        console.error(`Failed to process ${lead.business_name}:`, error);
        failed++;
      }
    }

    console.log(`✅ Processing complete: Scraped ${scraped}, Scored ${scored}, Failed ${failed}`);

    return NextResponse.json({
      success: failed === 0,
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

export async function GET(req: NextRequest) {
  return withAutomationRun("process-discovered-leads", req, () => handleGET(req));
}
