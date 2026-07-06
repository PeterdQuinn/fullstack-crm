import { NextRequest, NextResponse } from "next/server";
import { classifyReply } from "@/lib/grok";
import { actOnReplyClassification } from "@/lib/reply-actions";

export async function POST(req: NextRequest) {
  try {
    const { replyText, leadId } = await req.json();

    if (!replyText?.trim()) {
      return NextResponse.json({ error: "No reply text" }, { status: 400 });
    }

    const result = await classifyReply(replyText);

    // Automate the next step off the classification. Interested → Calendly link;
    // not interested → Do Not Contact; unclear → follow-up task.
    let automation: unknown = null;
    if (leadId) {
      try {
        automation = await actOnReplyClassification(leadId, result.category);
      } catch (err) {
        console.error("Reply automation failed:", err);
        automation = {
          error: err instanceof Error ? err.message : "automation failed",
        };
      }
    }

    return NextResponse.json({ ...result, automation });
  } catch (error) {
    console.error("Classify reply error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to classify" },
      { status: 500 }
    );
  }
}
