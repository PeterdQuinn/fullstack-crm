import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Always run fresh — otherwise Next statically caches this GET and serves
// stale build-time data.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Only list leads that SEND ALL NOW will actually send: same gate as
    // send-batch — a real AI score > 50 (inner join), has email, not suppressed,
    // under the 3-email cap. Without the score filter the queue showed unscored
    // leads as "ready" and then sent 0.
    const { data, error } = await supabase
      .from("leads")
      .select("id, business_name, contact_name, email, status, email_sent_count, lead_ai_summaries!inner(lead_score)")
      .eq("opt_out", false)
      .eq("bounced", false)
      .neq("status", "Do Not Contact")
      .neq("status", "Bad Email")
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .gt("lead_ai_summaries.lead_score", 50)
      .in("status", [
        "New",
        "Ready for Outreach",
        "Email 1 Sent",
        "Email 2 Sent",
      ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error("Queue error:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
