import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/resend";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 60;

const DIGEST_TO = "owner@fullstackservicesllc.net";

function countHead(query: any): Promise<number> {
  return query.then((r: any) => r.count || 0);
}

export async function POST(req: NextRequest) {
  // Same auth as process-followups.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const base = () => supabase.from("outreach_log");

    // Fire the independent count queries together.
    const [
      newLeads,
      leadsScored,
      opened,
      clicked,
      bounced,
      replies,
      meetings,
      suppressed,
      sentRows,
    ] = await Promise.all([
      countHead(
        supabase.from("leads").select("id", { count: "exact", head: true })
          .gte("created_at", startIso).lt("created_at", endIso)
      ),
      countHead(
        supabase.from("lead_ai_summaries").select("id", { count: "exact", head: true })
          .gte("created_at", startIso).lt("created_at", endIso)
      ),
      countHead(base().select("id", { count: "exact", head: true }).gte("opened_at", startIso).lt("opened_at", endIso)),
      countHead(base().select("id", { count: "exact", head: true }).gte("clicked_at", startIso).lt("clicked_at", endIso)),
      countHead(base().select("id", { count: "exact", head: true }).gte("bounced_at", startIso).lt("bounced_at", endIso)),
      countHead(base().select("id", { count: "exact", head: true }).gte("replied_at", startIso).lt("replied_at", endIso)),
      countHead(
        supabase.from("appointments").select("id", { count: "exact", head: true })
          .gte("created_at", startIso).lt("created_at", endIso)
      ),
      // Approximate: leads whose row was updated into a suppressed state in the window.
      // (No dedicated timestamp exists for when opt_out / Do Not Contact was set.)
      countHead(
        supabase.from("leads").select("id", { count: "exact", head: true })
          .or("opt_out.eq.true,status.eq.Do Not Contact")
          .gte("updated_at", startIso).lt("updated_at", endIso)
      ),
      // Emails sent in the window — fetch rows to break down by sequence number.
      supabase.from("outreach_log")
        .select("message_type")
        .eq("channel", "email")
        .gte("sent_at", startIso).lt("sent_at", endIso)
        .then((r) => r.data || []),
    ]);

    const email1 = sentRows.filter((r: any) => r.message_type === "email_1").length;
    const email2 = sentRows.filter((r: any) => r.message_type === "email_2").length;
    const email3 = sentRows.filter((r: any) => r.message_type === "email_3").length;
    const emailsSent = sentRows.length;

    const dateLabel = end.toISOString().split("T")[0];

    const activity =
      newLeads + leadsScored + emailsSent + opened + clicked + bounced + replies + meetings + suppressed;
    const quiet = activity === 0;

    const html = buildHtml({
      dateLabel,
      startIso,
      endIso,
      quiet,
      newLeads,
      leadsScored,
      emailsSent,
      email1,
      email2,
      email3,
      opened,
      clicked,
      bounced,
      replies,
      meetings,
      suppressed,
    });

    const subject = `CRM Daily Summary — ${dateLabel}`;
    await sendEmail(DIGEST_TO, subject, html);

    return NextResponse.json({
      success: true,
      sent_to: DIGEST_TO,
      window: { start: startIso, end: endIso },
      metrics: {
        newLeads,
        leadsScored,
        emailsSent,
        emailBreakdown: { email1, email2, email3 },
        opened,
        clicked,
        bounced,
        replies,
        meetings,
        suppressed,
      },
      quiet,
      notes: {
        reply_classification: "not tracked (computed on-demand in UI, never persisted)",
        cron_errors: "not tracked in DB (only in Vercel logs)",
      },
    });
  } catch (error) {
    console.error("Daily digest error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Daily digest failed" },
      { status: 500 }
    );
  }
}

function buildHtml(d: {
  dateLabel: string;
  startIso: string;
  endIso: string;
  quiet: boolean;
  newLeads: number;
  leadsScored: number;
  emailsSent: number;
  email1: number;
  email2: number;
  email3: number;
  opened: number;
  clicked: number;
  bounced: number;
  replies: number;
  meetings: number;
  suppressed: number;
}): string {
  const row = (label: string, value: number | string, indent = false) => `
    <tr>
      <td style="padding:6px 0;color:#555;font-size:14px;${indent ? "padding-left:20px;" : ""}">${label}</td>
      <td style="padding:6px 0;color:#111;font-size:14px;font-weight:600;text-align:right;">${value}</td>
    </tr>`;

  const section = (title: string, rows: string) => `
    <h3 style="margin:24px 0 4px;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#888;">${title}</h3>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;">${rows}</table>`;

  const quietBanner = d.quiet
    ? `<div style="margin:16px 0;padding:12px 16px;background:#f5f5f4;border-radius:8px;color:#555;font-size:14px;">
         Nothing happened in the last 24 hours — no new leads, emails, replies, or bookings.
         This email is your heartbeat: if it stops arriving, something in the pipeline or the
         digest cron is broken.
       </div>`
    : "";

  return `
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;">
    <h1 style="font-size:20px;margin:0 0 2px;">CRM Daily Summary</h1>
    <p style="margin:0;color:#999;font-size:13px;">${d.dateLabel} · last 24 hours</p>
    ${quietBanner}
    ${section("Pipeline", row("New leads discovered", d.newLeads) + row("Leads scored", d.leadsScored))}
    ${section(
      "Outreach",
      row("Emails sent", d.emailsSent) +
        row("Email 1 (initial)", d.email1, true) +
        row("Email 2 (follow-up)", d.email2, true) +
        row("Email 3 (follow-up)", d.email3, true)
    )}
    ${section(
      "Engagement",
      row("Opened", d.opened) + row("Clicked", d.clicked) + row("Bounced", d.bounced) + row("Replies received", d.replies)
    )}
    ${section("Outcomes", row("Meetings booked", d.meetings) + row("Do Not Contact / opted out", d.suppressed))}
    <p style="margin:28px 0 0;color:#bbb;font-size:11px;line-height:1.5;">
      Reply interested/not-interested breakdown and cron error counts are not included —
      neither is persisted in the database yet. "Do Not Contact / opted out" is approximate
      (based on when the lead row was last updated). Full Stack Services LLC · automated digest.
    </p>
  </div>`;
}
