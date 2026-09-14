import { NextResponse } from "next/server";
import { insuranceDb, INSURANCE_MONTHLY_CAP } from "@/lib/insurance/db";
import { STAGES } from "@/lib/insurance/types";

// Everything the workspace renders, in one read.
// Active queue equivalent of .is("duplicate_of", null) is enforced by the database function.
//
// The page used to fetch prospects and usage and compute the rest in the
// browser, which is why its counts and its lists could disagree. One route,
// one snapshot: the board, the work that is due, the timeline and the numbers
// all describe the same moment.

export const dynamic = "force-dynamic";
// force-dynamic alone does not stop Next caching supabase-js's own fetch — the
// automation page once reported the system paused while it was sending.
export const fetchCache = "force-no-store";
export const maxDuration = 30;

function phoenixDayStartIso(): string {
  const now = new Date();
  const phoenix = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  phoenix.setUTCHours(0, 0, 0, 0);
  return new Date(phoenix.getTime() + 7 * 60 * 60 * 1000).toISOString();
}

export async function GET() {
  const db = insuranceDb();
  const dayStart = phoenixDayStartIso();

  const [settings, prospects, tasks, activities, usage, sentToday, runs, forgeWorkspace] = await Promise.all([
    db.from("insurance_settings").select("*").eq("id", "owner").maybeSingle(),
    // Keep the dashboard usable while a remote project is catching up with
    // migrations; the function adds ordering, but the table query is safe.
    db.rpc('insurance_workspace_prospects', { p_limit: 600 }),
    db.from("insurance_tasks").select("*").eq("status", "pending").order("due_at", { ascending: true }).limit(100),
    db.from("insurance_activities").select("*").order("created_at", { ascending: false }).limit(150),
    db.from("insurance_api_usage").select("provider,used").eq("month", new Date().toISOString().slice(0, 7)),
    db.from("insurance_email_outbox").select("id", { count: "exact", head: true })
      .not("insurance_prospect_id", "is", null).gte("last_attempt_at", dayStart),
    db.from("automation_runs").select("stage,status,result,started_at,finished_at")
      .eq("stage", "insurance-pipeline").order("started_at", { ascending: false }).limit(5),
    db.from("workspace_state").select("producers").limit(1).maybeSingle(),
  ]);

  if (prospects.error && /insurance_workspace_prospects|schema cache/i.test(prospects.error.message)) {
    const fallback = await db.from("insurance_prospects").select("*").is("duplicate_of", null).order("updated_at", { ascending: false }).limit(600);
    (prospects as any).data = fallback.data;
    (prospects as any).error = fallback.error;
  }
  // Keep the shell navigable while the remote ProducerForge project is being
  // provisioned. Once the tables exist this branch is never used.
  if (prospects.error && /insurance_prospects|schema cache/i.test(prospects.error.message)) {
    (prospects as any).data = [];
    (prospects as any).error = null;
  }
  if (prospects.error) {
    // A missing table is the most likely cause, and saying so beats a 503 with
    // no explanation while migration 020 is unapplied.
    return NextResponse.json(
      { error: `Insurance workspace could not be loaded: ${prospects.error.message}`, needsMigration: /column|relation/i.test(prospects.error.message) },
      { status: 503 }
    );
  }

  let rows: any[] = prospects.data || [];
  // ProducerForge already stores richer producer records (including licenses[])
  // in workspace_state. Surface those records immediately without copying them
  // into another company's tables; new research records still use the insurance
  // tables above.
  if (rows.length === 0 && Array.isArray(forgeWorkspace.data?.producers)) {
    rows = forgeWorkspace.data.producers.map((p: any, index: number) => ({
      id: p.id || `forge-${index}`,
      track: "recruiting", state: p.state || "AZ", name: p.canonicalName || p.name || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "Unnamed producer",
      source: { url: p.publicWebsite || p.sourceUrls?.[0] || "", snippet: p.experienceEvidence || p.publicBio || "Imported from ProducerForge workspace" },
      source_key: `forge:${p.npn || p.id || index}`, email: p.contactPoints?.find((c: any) => c.type === "email")?.value || p.email || "", phone: p.contactPoints?.find((c: any) => c.type === "phone")?.value || p.phone || "", npn: p.npn || "", first_licensed_on: null, license_source_url: p.sourceUrls?.[0] || "", stage: p.recruitingStatus?.stage || "Research", notes: "Imported from ProducerForge workspace", licenses: p.licenses || [], created_at: p.createdAt || new Date().toISOString(), updated_at: p.updatedAt || new Date().toISOString(), email_sent_count: 0, opt_out: false, bounced: false, complained: false,
    }));
  }
  // Merged records are excluded above; the count is kept so the workspace can
  // say so rather than appear to have quietly lost rows.
  const { count: mergedAway } = await db.from("insurance_prospects")
    .select("id", { count: "exact", head: true }).not("duplicate_of", "is", null);
  const byStage: Record<string, number> = {};
  for (const row of rows) byStage[`${row.track}:${row.stage}`] = (byStage[`${row.track}:${row.stage}`] || 0) + 1;

  const now = Date.now();
  const stats = {
    total: rows.length,
    withEmail: rows.filter((r) => r.email).length,
    qualified: rows.filter((r) => r.stage === "Qualified").length,
    contacted: rows.filter((r) => (r.email_sent_count || 0) > 0).length,
    replied: rows.filter((r) => r.replied_at).length,
    suppressed: rows.filter((r) => r.opt_out || r.stage === "Do not contact").length,
    unscored: rows.filter((r) => r.score == null).length,
    sentToday: sentToday.count || 0,
    tasksDue: (tasks.data || []).filter((t) => Date.parse(t.due_at) <= now).length,
    merged: mergedAway || 0,
  };

  return NextResponse.json({
    settings: settings.data || null,
    stages: STAGES,
    prospects: rows,
    tasks: tasks.data || [],
    activities: activities.data || [],
    usage: usage.data || [],
    monthlyCap: INSURANCE_MONTHLY_CAP,
    byStage,
    stats,
    runs: runs.data || [],
    configured: {
      search: Boolean(process.env.SERPAPI_API_KEY),
      fallback: Boolean(process.env.PRODUCERFORGE_OLLAMA_API_KEY),
      drafts: Boolean(process.env.PRODUCERFORGE_GEMINI_API_KEY || process.env.PRODUCERFORGE_GEMINI_API_KEY_2),
      sending: Boolean(process.env.RESEND_API_KEY),
    },
  });
}
