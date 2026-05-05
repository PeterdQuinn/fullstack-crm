import { NextRequest, NextResponse } from "next/server";
import { classifyReply } from "@/lib/grok";

export async function POST(req: NextRequest) {
  try {
    const { replyText, leadId } = await req.json();

    if (!replyText?.trim()) {
      return NextResponse.json({ error: "No reply text" }, { status: 400 });
    }

    const result = await classifyReply(replyText);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Classify reply error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to classify" },
      { status: 500 }
    );
  }
}
