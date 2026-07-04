import { NextRequest, NextResponse } from "next/server";
import { runAutomationPhase } from "@/lib/automation";

export const maxDuration = 60;

// Thin HTTP wrapper for manual UI triggering. The actual pipeline logic lives
// in lib/automation.ts so the daily cron can call it in-process (see
// app/api/cron/automation/route.ts). This route stays under /api/admin and is
// therefore behind the Basic Auth middleware.
export async function POST(req: NextRequest) {
  try {
    const { phase = "scrape" } = await req.json().catch(() => ({}));
    const result = await runAutomationPhase(phase);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Pipeline error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pipeline failed" },
      { status: 500 }
    );
  }
}
