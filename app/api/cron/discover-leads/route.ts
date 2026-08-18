import { NextRequest, NextResponse } from "next/server";
import { runDiscoveryPipeline } from "@/lib/discovery-pipeline";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ success: false, error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDiscoveryPipeline({ states: 1, importToDb: true });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Automated discovery failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
