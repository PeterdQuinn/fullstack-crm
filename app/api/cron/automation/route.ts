import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    // Vercel cron jobs are internal and secure, no auth needed
    const isVercelCron = req.headers.get("x-vercel-cron-secret");
    // Accept both Vercel internal cron and manual triggers


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
