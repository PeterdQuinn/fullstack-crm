import { NextRequest, NextResponse } from "next/server";
import { enrichLeadsBatch } from "@/lib/enrich";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// GET is what Vercel Cron sends. An UNAUTHENTICATED GET returns the browser
// health check; an AUTHENTICATED GET runs the job.
//
// This split matters: the previous GET was health-check-only, so a Vercel Cron
// pointed here would have received a cheerful 200 and enriched nothing —
// a green check with no work behind it, which is worse than a hard failure.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authed = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;

  if (!authed) {
    return NextResponse.json({
      status: "ok",
      route: "/api/cron/enrich-leads",
      methods: "GET or POST with Authorization: Bearer <CRON_SECRET> runs the job",
      note: "Unauthenticated GET is this health check and does NOT run the job.",
      cron_secret_configured: Boolean(cronSecret),
    });
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
    return NextResponse.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Enrich cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}
