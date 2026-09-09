import { withAutomationRun } from "@/lib/automation-runs";
import { NextRequest, NextResponse } from "next/server";
import { enrichLeadsBatch } from "@/lib/enrich";
import { researchLeadsBatch } from "@/lib/lead-research";

// Internet research runs here too; Firecrawl search + scrape needs the headroom.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// GET is what Vercel Cron sends. A bad or missing secret returns 401 — never a
// 200.
//
// There used to be an unauthenticated "health check" 200 here. It actively hid
// a real outage: a scheduler holding the wrong secret got a cheerful 200 body
// and enriched nothing, so every job looked green while `outreach_log` sat at
// zero. A wrong secret must fail loudly.
async function handleGET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runEnrich(req);
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runEnrich(req);
}

async function runEnrich(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Number(body.batchSize) || 3, 8);

  try {
    const result = await enrichLeadsBatch(batchSize);
    // Internet research runs in the same slot so evidence exists before the
    // scoring pass an hour later and the send pass an hour after that.
    const research = await researchLeadsBatch(Number(body.researchBatchSize) || 2);
    const errors = [...research.errors];
    return NextResponse.json({
      success: errors.length === 0,
      ...result,
      research,
      errors,
      timestamp: new Date().toISOString(),
    }, { status: errors.length ? 500 : 200 });
  } catch (error) {
    console.error("Enrich cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return withAutomationRun("enrich-leads", req, () => handleGET(req));
}
