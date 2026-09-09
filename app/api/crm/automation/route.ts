import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_LOCATIONS, discoveryTerms } from "@/lib/targeting";
import { STAGE_SCHEDULE, nextRunAt } from "@/lib/automation-schedule";
import { DAILY_SEND_CAP } from "@/lib/automation";
import { phoenixDayStartIso } from "@/lib/lead-stats";
// force-dynamic alone is not enough: Next caches supabase-js's own fetch, so
// this route served enabled=false for minutes after the flag was set true. On
// this page that is the worst possible staleness — it reports the system paused
// while it is sending. Same treatment as the other read routes.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } }
);

// A run left "running" past this is not running; the function died mid-flight.
const STALE_RUN_MS = 300_000;

export async function GET() {
  const dayStart = phoenixDayStartIso();
  const since = new Date(Date.now() - 86_400_000).toISOString();

  const [settings, runs, outbox, sentToday, discoveredToday, researchedToday] = await Promise.all([
    db.from("automation_settings").select("*").eq("id", "owner").single(),
    db.from("automation_runs").select("id,stage,status,result,started_at,finished_at").gte("started_at", since).order("started_at", { ascending: false }).limit(300),
    db.from("email_outbox").select("id,recipient,subject,status,attempts,error_message,created_at,accepted_at,finalized_at,last_attempt_at").order("created_at", { ascending: false }).limit(200),
    db.from("outreach_log").select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("channel", "email").gte("sent_at", dayStart),
    db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", dayStart),
    db.from("lead_internet_intelligence").select("lead_id", { count: "exact", head: true }).gte("researched_at", dayStart),
  ]);
  const error = settings.error || runs.error || outbox.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const runRows = runs.data || [];
  const isStale = (r: any) => r.status === "running" && Date.parse(r.started_at) < Date.now() - STALE_RUN_MS;

  // Per stage: did it run, did it work, when does it go again. This is the
  // question the page exists to answer; it previously offered a JSON dump.
  const stages = STAGE_SCHEDULE.map((schedule) => {
    const forStage = runRows.filter((r: any) => r.stage === schedule.stage);
    const last = forStage[0] || null;
    const failed = forStage.filter((r: any) => r.status === "failed" || isStale(r));
    // "Failing" means the most recent run failed, not that any run failed today.
    // A stage that broke at 21:31 and has succeeded twice since is working, and
    // saying otherwise trains the reader to ignore the banner.
    const broken = Boolean(last) && (last.status === "failed" || isStale(last));
    const latestError = broken ? (last.result?.error || last.result?.errors?.[0] || null) : null;
    return {
      stage: schedule.stage,
      label: schedule.label,
      description: schedule.description,
      runs24h: forStage.length,
      failed24h: failed.length,
      lastStatus: last ? (isStale(last) ? "died" : last.status) : null,
      broken,
      lastRunAt: last?.started_at || null,
      nextRunAt: nextRunAt(schedule),
      error: latestError ? String(latestError).slice(0, 300) : null,
    };
  });

  const outboxRows = outbox.data || [];
  const needsAttention = outboxRows.filter((o: any) =>
    o.status === "needs_review" || o.error_message ||
    (o.status === "sending" && Date.parse(o.last_attempt_at || o.created_at) < Date.now() - STALE_RUN_MS) ||
    (o.accepted_at && !o.finalized_at));
  const outboxCounts = outboxRows.reduce((acc: Record<string, number>, o: any) => {
    acc[o.status] = (acc[o.status] || 0) + 1; return acc;
  }, {});

  return NextResponse.json({
    settings: { ...settings.data, locations: settings.data.locations.length ? settings.data.locations : DEFAULT_LOCATIONS },
    today: {
      sent: sentToday.count || 0,
      cap: DAILY_SEND_CAP,
      discovered: discoveredToday.count || 0,
      researched: researchedToday.count || 0,
    },
    stages,
    health: {
      runs24h: runRows.length,
      failed24h: runRows.filter((r: any) => r.status === "failed" || isStale(r)).length,
      brokenStages: stages.filter((s) => s.broken).map((s) => s.label),
      recoveredStages: stages.filter((s) => !s.broken && s.failed24h > 0).map((s) => s.label),
    },
    outbox: { counts: outboxCounts, total: outboxRows.length, needsAttention: needsAttention.slice(0, 25) },
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body.enabled !== "boolean" || !Array.isArray(body.niches) || !body.niches.length || body.niches.length > 100) throw new Error("Choose at least one niche (maximum 100)");
    const niches = [...new Set(body.niches.map((n: unknown) => { if (typeof n !== "string") throw new Error("Invalid niche"); return discoveryTerms(n).niche; }))];
    if (!Array.isArray(body.locations) || !body.locations.length || body.locations.length > 100) throw new Error("Choose at least one US city and state (maximum 100)");
    const locations = body.locations.map((l: any) => {
      if (typeof l.city !== "string" || !l.city.trim() || l.city.length > 80 || !/^[A-Z]{2}$/.test(l.state)) throw new Error("Locations need a city and two-letter state");
      return { city: l.city.trim(), state: l.state };
    });
    const { data, error } = await db.from("automation_settings").update({ enabled: body.enabled, niches, locations, cursor: 0, updated_at: new Date().toISOString() }).eq("id", "owner").select("*").single();
    if (error) throw new Error(`Settings were not saved: ${error.message}`);
    return NextResponse.json({ settings: data });
  } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
}
