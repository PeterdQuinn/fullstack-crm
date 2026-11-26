import { withAutomationRun } from "@/lib/automation-runs";
import { NextRequest, NextResponse } from "next/server";
import { researchLeadsBatch } from "@/lib/lead-research";

// Internet research is its own scheduled stage, not a passenger on enrichment.
//
// It rode along inside enrich-leads at first. One lead's research is four
// Firecrawl searches, up to five page scrapes and an LLM read, which measured
// at up to 90s on its own — a deadline that only stops *starting* another lead
// cannot bound that, and the combined route hit 137s against a 120s ceiling.
// Split out, each stage gets a full budget and neither can starve the other.
//
// Runs between enrichment and scoring so evidence exists before anything reads it.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  // Middleware deliberately skips /api/cron, so every verb must check the
  // secret here. POST also bypasses the pause gate in withAutomationRun, which
  // makes an unguarded POST both a free Firecrawl spend and a way to run a
  // stage the owner has switched off.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedBatch = Number(body.batchSize);
  const batchSize = Number.isFinite(requestedBatch)
    ? Math.max(1, Math.min(10, Math.floor(requestedBatch)))
    : 2;
  // Force refresh is a controlled reprocessing path for records researched
  // before the source-quality fix. It remains behind CRON_SECRET and the
  // automation pause gate; ordinary scheduled GETs always honor the TTL.
  const forceRefresh = req.method === "POST" && body.forceRefresh === true;
  try {
    const research = await researchLeadsBatch(batchSize, 45_000, forceRefresh);
    return NextResponse.json({
      success: research.errors.length === 0,
      ...research,
      timestamp: new Date().toISOString(),
    }, { status: research.errors.length ? 500 : 200 });
  } catch (error) {
    console.error("Research cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Research failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return withAutomationRun("research-leads", req, () => run(req));
}

export async function GET(req: NextRequest) {
  return withAutomationRun("research-leads", req, () => run(req));
}
