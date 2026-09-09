import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Everything the Reports page shows.
//
// This used to count six hardcoded terminal statuses. On live data that meant
// the page rendered 31 of 386 leads: four of the six sat at zero, "Dead" was
// not in the list at all, and the 169 leads in Ready for Outreach — the actual
// state of the business — were invisible. Statuses are now read from the data
// rather than from a constant, so a status added to the schema shows up here
// without a code change.
//
// The email funnel is new. Open and click tracking was switched on after 352
// sends had already gone out with no engagement data at all, so the rates below
// only describe mail sent from that point forward.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } }
);

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// Pipeline order, so the table reads as a funnel rather than alphabetically.
const STAGE_ORDER = [
  "New", "Scored", "Ready for Outreach", "Email 1 Sent", "Email 2 Sent", "Email 3 Sent",
  "Follow-Up Scheduled", "Replied", "Interested", "Booking Link Sent", "Booked",
  "Onboarding Sent", "Onboarding Completed", "Won",
  "No Response", "Lost", "Do Not Contact", "Bad Email", "Bad Data", "Dead",
];
const TERMINAL = new Set(["Won", "Lost", "Do Not Contact", "Bad Data", "Bad Email", "No Response", "Dead"]);

function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export async function GET(req: NextRequest) {
  try {
    const range = req.nextUrl.searchParams.get("range") || "all";
    const days = range === "30" || range === "90" ? Number(range) : null;
    const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

    let leadQuery = supabase.from("leads").select("status, email, opt_out, bounced, archived_at, updated_at");
    if (since) leadQuery = leadQuery.gte("updated_at", since);

    let sendQuery = supabase.from("outreach_log")
      .select("message_type, delivered_at, opened_at, clicked_at, replied_at, bounced_at, failed_at")
      .eq("direction", "outbound").eq("channel", "email");
    if (since) sendQuery = sendQuery.gte("sent_at", since);

    const [{ data: leads, error: leadError }, { data: sends, error: sendError }] = await Promise.all([leadQuery, sendQuery]);
    if (leadError) throw leadError;
    if (sendError) throw sendError;

    const rows = leads || [];
    const counts = new Map<string, number>();
    for (const row of rows) {
      const status = row.status || "Unknown";
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    // Known stages first in funnel order, then anything the schema grew since.
    const seen = [...counts.keys()];
    const ordered = [
      ...STAGE_ORDER.filter((s) => counts.has(s)),
      ...seen.filter((s) => !STAGE_ORDER.includes(s)).sort(),
    ];
    const total = rows.length;
    const pipeline = ordered.map((status) => ({
      status,
      count: counts.get(status) || 0,
      pct: rate(counts.get(status) || 0, total),
      terminal: TERMINAL.has(status),
    }));

    const sent = (sends || []).length;
    const funnel = {
      sent,
      delivered: (sends || []).filter((s: any) => s.delivered_at).length,
      opened: (sends || []).filter((s: any) => s.opened_at).length,
      clicked: (sends || []).filter((s: any) => s.clicked_at).length,
      replied: (sends || []).filter((s: any) => s.replied_at).length,
      bounced: (sends || []).filter((s: any) => s.bounced_at).length,
      failed: (sends || []).filter((s: any) => s.failed_at).length,
    };
    const rates = {
      delivered: rate(funnel.delivered, sent),
      opened: rate(funnel.opened, sent),
      clicked: rate(funnel.clicked, sent),
      replied: rate(funnel.replied, sent),
      bounced: rate(funnel.bounced, sent),
    };
    const touches = [1, 2, 3].map((n) => {
      const forTouch = (sends || []).filter((s: any) => s.message_type === `email_${n}`);
      return {
        touch: `Email ${n}`,
        sent: forTouch.length,
        opened: forTouch.filter((s: any) => s.opened_at).length,
        replied: forTouch.filter((s: any) => s.replied_at).length,
      };
    });

    // Supply: what can actually be mailed, versus what merely looks ready.
    const live = rows.filter((r: any) => !r.archived_at && !r.opt_out);
    const supply = {
      totalLeads: total,
      mailable: live.filter((r: any) => r.email && !r.bounced).length,
      readyAwaitingEmail: live.filter((r: any) => r.status === "Ready for Outreach" && !r.email).length,
      inSequence: live.filter((r: any) => /^Email [123] Sent$/.test(r.status || "")).length,
    };

    return Response.json({ range, total, pipeline, funnel, rates, touches, supply });
  } catch (error) {
    console.error("Reports error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Reports failed" },
      { status: 500 }
    );
  }
}
