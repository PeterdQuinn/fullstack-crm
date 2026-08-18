import { NextRequest, NextResponse } from "next/server";
import { runDiscoveryPipeline } from "@/lib/discovery-pipeline";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const options = await req.json().catch(() => ({}));
    return NextResponse.json(await runDiscoveryPipeline(options));
  } catch (error) {
    console.error("Discovery pipeline error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Discovery failed" },
      { status: 500 }
    );
  }
}
