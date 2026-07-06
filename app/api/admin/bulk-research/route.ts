import { NextRequest, NextResponse } from "next/server";
import { enrichLeadsBatch } from "@/lib/enrich";

// Manual enrichment trigger (from the UI). Same batch logic as the
// /api/cron/enrich-leads cron route. Small batch per call — scrapes are slow.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { batchSize = 3 } = await req.json().catch(() => ({}));
    const result = await enrichLeadsBatch(Math.min(Number(batchSize) || 3, 8));
    return NextResponse.json({
      success: true,
      ...result,
      message: `Processed ${result.processed} leads — ${result.emailsFound} emails, ${result.socialsFound} socials found.`,
    });
  } catch (error) {
    console.error("Bulk research error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Research failed" },
      { status: 500 }
    );
  }
}
