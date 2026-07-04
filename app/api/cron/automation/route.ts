import { NextRequest, NextResponse } from "next/server";

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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Run the three phases of automation
    const phases = ["scrape", "score", "send"];
    const results = [];

    for (const phase of phases) {
      try {
        const res = await fetch(`${appUrl}/api/admin/automation-pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase }),
        });

        const data = await res.json();
        results.push({ phase, success: res.ok, data });
        console.log(`✓ Phase ${phase} completed`);
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
