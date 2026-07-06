import { NextRequest, NextResponse } from "next/server";
import { enrichLeadsBatch } from "@/lib/enrich";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Health check — open in a browser to see JSON instead of a 405. Does NOT run
// the job (POST-only).
export async function GET() {
  return NextResponse.json({
    status: "ok",
    route: "/api/cron/enrich-leads",
    method: "POST",
    auth: "Authorization: Bearer <CRON_SECRET>",
    note: "Processes one small enrichment batch per call. Trigger from cron-job.org.",
    cron_secret_configured: Boolean(process.env.CRON_SECRET),
  });
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
