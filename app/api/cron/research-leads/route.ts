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
  const body = await req.json().catch(() => ({}));
  try {
    const research = await researchLeadsBatch(Number(body.batchSize) || 2);
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

async function handleGET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

export async function GET(req: NextRequest) {
  return withAutomationRun("research-leads", req, () => handleGET(req));
}
