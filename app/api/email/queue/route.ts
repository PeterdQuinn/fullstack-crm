import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// force-dynamic alone isn't enough — Next also caches the fetch() supabase-js
// makes to PostgREST, so the queue would serve a stale snapshot (e.g. 0 ready
// even after leads were scored). no-store fetch + fetchCache guarantee live data.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  }
);

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
