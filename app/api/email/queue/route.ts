import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { renderOutreachEmail } from "@/lib/email-templates";

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
      .select(
        "id, business_name, contact_name, email, status, email_sent_count, lead_ai_summaries!inner(lead_score, recommended_first_message, recommended_follow_up)"
      )
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

    // Render each lead's ready-to-send email server-side (single source of
    // truth in lib/email-templates) so the manual queue shows exactly what the
    // send phase would produce — subject + body + copy-paste text.
    const rendered = (data || []).map((lead: any) => {
      const summary = Array.isArray(lead.lead_ai_summaries)
        ? lead.lead_ai_summaries[0]
        : lead.lead_ai_summaries;
      const email = renderOutreachEmail({
        businessName: lead.business_name,
        emailSentCount: lead.email_sent_count || 0,
        firstMessage: summary?.recommended_first_message,
        followUp: summary?.recommended_follow_up,
      });
      return {
        id: lead.id,
        business_name: lead.business_name,
        contact_name: lead.contact_name || null,
        email: lead.email,
        status: lead.status,
        email_sent_count: lead.email_sent_count || 0,
        emailNum: email.emailNum,
        subject: email.subject,
        bodyText: email.bodyText,
        copyText: email.copyText,
      };
    });

    return NextResponse.json(rendered);
  } catch (error) {
    console.error("Queue error:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
