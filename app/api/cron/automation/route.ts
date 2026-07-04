import { NextRequest, NextResponse } from "next/server";
import { runAutomationPhase } from "@/lib/automation";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Require a valid CRON_SECRET (same pattern as the other cron routes).
  // Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`
  // when CRON_SECRET is configured on the project.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Run the three phases in-process (direct function calls). No HTTP self-call,
    // so this is not blocked by the Basic Auth middleware on /api/admin and does
    // not pay a second serverless cold-start per phase.
    const phases = ["scrape", "score", "send"];
    const results = [];

    for (const phase of phases) {
      try {
        const result = await runAutomationPhase(phase);
        results.push({ phase, success: true, result });
        console.log(`✓ Phase ${phase} completed`, result);
      } catch (error) {
        console.error(`Error in phase ${phase}:`, error);
        results.push({ phase, success: false, error: String(error) });
      }
    }

    return NextResponse.json({
      success: true,
      message: "✅ Daily automation completed",
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron failed" },
      { status: 500 }
    );
  }
}
