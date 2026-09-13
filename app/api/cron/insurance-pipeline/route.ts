import { NextRequest, NextResponse } from "next/server";
import { withAutomationRun } from "@/lib/automation-runs";
import {
  insuranceSettings,
  discoverInsuranceProspects,
  enrichInsuranceProspects,
  qualifyInsuranceProspects,
  sendInsuranceOutreach,
} from "@/lib/insurance/pipeline";

// One scheduled route for the whole insurance pipeline.
//
// The HVAC side has a route per stage because each stage is expensive enough to
// need its own function budget. Insurance is cheaper by an order of magnitude —
// one capped search, a handful of static fetches, a few short LLM calls — so
// the four phases share a single run and a single 120s ceiling, with a deadline
// between phases so a slow one cannot starve the rest.
//
// ?phase=discover|enrich|qualify|send runs one stage on demand.

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const PHASES = ["discover", "enrich", "qualify", "send"] as const;
type Phase = (typeof PHASES)[number];

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ success: false, error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const requested = req.nextUrl.searchParams.get("phase") as Phase | null;
  if (requested && !PHASES.includes(requested)) {
    return NextResponse.json({ success: false, error: `Unknown phase: ${requested}` }, { status: 400 });
  }

  const settings = await insuranceSettings();
  // The insurance switch is separate from the HVAC one on purpose: one pipeline
  // being paused says nothing about whether the other should be.
  if (!settings.enabled) {
    return NextResponse.json({ success: true, paused: true, message: "The insurance pipeline is switched off in settings" });
  }

  const phases = requested ? [requested] : PHASES;
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const startedAt = Date.now();

  for (const phase of phases) {
    // Leave room for the phase to finish inside the route's ceiling.
    if (Date.now() - startedAt > 85_000) {
      results[phase] = { skipped: "no time left in this run" };
      continue;
    }
    try {
      if (phase === "discover") results.discover = await discoverInsuranceProspects(settings);
      if (phase === "enrich") results.enrich = await enrichInsuranceProspects();
      if (phase === "qualify") results.qualify = await qualifyInsuranceProspects();
      if (phase === "send") results.send = await sendInsuranceOutreach(settings);
      const phaseErrors = (results[phase] as { errors?: string[] })?.errors || [];
      errors.push(...phaseErrors.map((e) => `${phase}: ${e}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[phase] = { error: message };
      errors.push(`${phase}: ${message}`);
    }
  }

  return NextResponse.json(
    {
      success: errors.length === 0,
      sendingEnabled: settings.sending_enabled,
      ...results,
      errors,
      timestamp: new Date().toISOString(),
    },
    { status: errors.length ? 500 : 200 }
  );
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return withAutomationRun("insurance-pipeline", req, () => run(req));
}
