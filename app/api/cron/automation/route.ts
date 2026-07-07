import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runAutomationPhase } from "@/lib/automation";
import { sendEmail } from "@/lib/resend";

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Record a failed phase and alert the owner. Best-effort: a failure here must
// never mask the original phase error or crash the cron, so everything is
// wrapped and swallowed with a log.
async function reportPhaseFailure(phase: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  try {
    await supabase.from("cron_failures").insert({ phase, error_message: message });
  } catch (logErr) {
    console.error("Failed to log cron failure:", logErr);
  }

  const to = process.env.OWNER_ALERT_EMAIL;
  if (!to) {
    console.warn("OWNER_ALERT_EMAIL not set — skipping cron failure email.");
    return;
  }
  try {
    await sendEmail(
      to,
      `⚠️ CRM automation failed: ${phase} phase`,
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color:#b91c1c;">Automation phase failed</h2>
        <p><strong>Phase:</strong> ${phase}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><strong>Error:</strong></p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-word;">${message}</pre>
        <p style="color:#999;font-size:12px;margin-top:20px;">Full Stack Services CRM — cron alert</p>
      </div>`
    );
  } catch (mailErr) {
    console.error("Failed to send cron failure email:", mailErr);
  }
}

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
        // Log to cron_failures + email the owner (best-effort, never throws).
        await reportPhaseFailure(phase, error);
        results.push({ phase, success: false, error: String(error) });
      }
    }

    // item 6: clear "what was sent and where" readout for this run.
    const sendEntry = results.find(
      (r: any) => r.success && r.result?.phase === "send"
    ) as any;
    const emailedThisRun = sendEntry?.result?.emailed ?? [];

    return NextResponse.json({
      success: true,
      message: "✅ Daily automation completed",
      emailedThisRun,
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
