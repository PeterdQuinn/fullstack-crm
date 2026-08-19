import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { renderOutreachEmail } from "@/lib/email-templates";
import { sendBlockedReason } from "@/lib/email-templates";
import { DAILY_SEND_CAP } from "@/lib/automation";
import { phoenixDayStartIso } from "@/lib/lead-stats";

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
        `id, business_name, contact_name, owner_name, email, phone, website,
        address, city, state, industry, niche, status, email_sent_count,
        next_follow_up_at, current_software, monthly_spend_estimate,
        short_description, pain_point, bounced, complained,
        lead_ai_summaries!inner(lead_score, confidence_level, main_pain_point,
          pain_reason, best_attack_angle, recommended_first_message,
          recommended_follow_up),
        follow_up_tasks(id, task_type, due_at, status),
        outreach_log(id, direction, message_type, subject, status, sent_at,
          delivered_at, opened_at, clicked_at, replied_at, bounced_at)`
      )
      .eq("opt_out", false)
      .eq("bounced", false)
      .neq("status", "Do Not Contact")
      .neq("status", "Bad Email")
      .not("email", "is", null)
      .neq("email", "")
      .lt("email_sent_count", 3)
      .is("archived_at", null)
      .gt("lead_ai_summaries.lead_score", 50)
      .or("industry.ilike.HVAC,niche.ilike.HVAC")
      .in("status", [
        "Ready for Outreach",
        "Email 1 Sent",
        "Email 2 Sent",
        "Follow-Up Scheduled",
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
        leadId: lead.id,
        businessName: lead.business_name,
        ownerName: (lead as any).owner_name,
        emailSentCount: lead.email_sent_count || 0,
      });
      const pendingTask = [...(lead.follow_up_tasks || [])]
        .filter((task: any) => task.status === "pending" && task.task_type === `send_email_${email.emailNum}`)
        .sort((a: any, b: any) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0];
      return {
        id: lead.id,
        business_name: lead.business_name,
        contact_name: lead.contact_name || null,
        owner_name: lead.owner_name || null,
        email: lead.email,
        phone: lead.phone,
        website: lead.website,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        industry: lead.industry || lead.niche,
        short_description: lead.short_description,
        current_software: lead.current_software,
        monthly_spend_estimate: lead.monthly_spend_estimate,
        next_follow_up_at: pendingTask?.due_at || lead.next_follow_up_at,
        score: summary?.lead_score || 0,
        confidence: summary?.confidence_level,
        main_pain_point: summary?.main_pain_point || lead.pain_point,
        best_attack_angle: summary?.best_attack_angle,
        history: [...(lead.outreach_log || [])]
          .sort((a: any, b: any) => new Date(b.sent_at || b.replied_at || 0).getTime() - new Date(a.sent_at || a.replied_at || 0).getTime())
          .slice(0, 8),
        status: lead.status,
        email_sent_count: lead.email_sent_count || 0,
        emailNum: email.emailNum,
        subject: email.subject,
        bodyText: email.bodyText,
        copyText: email.copyText,
      };
    });

    rendered.sort((a: any, b: any) => {
      const aDue = a.next_follow_up_at ? new Date(a.next_follow_up_at).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.next_follow_up_at ? new Date(b.next_follow_up_at).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return b.score - a.score;
    });

    const [{ count: sentToday }, { count: bounced }, { count: complained }] = await Promise.all([
      supabase.from("outreach_log").select("id", { count: "exact", head: true }).eq("channel", "email").eq("direction", "outbound").gte("sent_at", phoenixDayStartIso()),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("bounced", true),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("complained", true),
    ]);

    return NextResponse.json({
      leads: rendered,
      safety: {
        sentToday: sentToday || 0,
        dailyCap: DAILY_SEND_CAP,
        remaining: Math.max(0, DAILY_SEND_CAP - (sentToday || 0)),
        bounced: bounced || 0,
        complained: complained || 0,
        blockedReason: sendBlockedReason(),
      },
    });
  } catch (error) {
    console.error("Queue error:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
