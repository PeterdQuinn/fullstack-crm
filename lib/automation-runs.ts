import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function withAutomationRun(stage: string, req: NextRequest, run: () => Promise<Response>) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { data: settings, error: settingsError } = await db.from("automation_settings").select("enabled").eq("id", "owner").single();
  if (settingsError) return NextResponse.json({ success: false, error: `Could not load saved automation settings: ${settingsError.message}` }, { status: 500 });
  if (!settings.enabled) return NextResponse.json({ success: true, paused: true, message: "Automation is paused in saved settings" });
  const { data: record, error } = await db.from("automation_runs").insert({ stage }).select("id").single();
  if (error) return NextResponse.json({ success: false, error: `Automation did not start: could not save run: ${error.message}` }, { status: 500 });
  try {
    const response = await run();
    const body = await response.clone().json();
    const failed = !response.ok || body.success === false || Number(body.failed || 0) > 0 ||
      (Array.isArray(body.errors) ? body.errors.length > 0 : Number(body.errors || 0) > 0);
    const { error: saveError } = await db.from("automation_runs").update({ status: failed ? "failed" : "completed", result: body, finished_at: new Date().toISOString() }).eq("id", record.id);
    if (saveError) throw new Error(`Could not save automation result: ${saveError.message}`);
    return NextResponse.json({ ...body, success: !failed, runId: record.id }, { status: failed ? 500 : response.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { error: saveError } = await db.from("automation_runs").update({ status: "failed", result: { error: message }, finished_at: new Date().toISOString() }).eq("id", record.id);
    return NextResponse.json({ success: false, error: message, runId: record.id, ...(saveError ? { persistenceError: saveError.message } : {}) }, { status: 500 });
  }
}
