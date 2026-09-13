import { NextRequest, NextResponse } from "next/server";
import { insuranceDb } from "@/lib/insurance/db";
import { STAGES, type InsuranceTrack } from "@/lib/insurance/types";
import { InsuranceInputError } from "@/lib/insurance/validation";
import {
  insuranceSettings,
  discoverInsuranceProspects,
  enrichInsuranceProspects,
  qualifyInsuranceProspects,
  sendInsuranceOutreach,
} from "@/lib/insurance/pipeline";
import { renderInsuranceEmail, sendInsuranceTouch, sendRefusal } from "@/lib/insurance/outreach";

// Every action the workspace can take on a saved record.
//
// One route rather than eight, because each of these is the same shape: check
// the input, do the thing, write the timeline entry that explains it. The
// timeline is the point — a stage that moved with no record of who moved it or
// why is how a pipeline stops being trustworthy.

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

async function note(prospectId: string, kind: string, summary: string, detail: Record<string, unknown> = {}) {
  const { error } = await insuranceDb().from("insurance_activities").insert({
    prospect_id: prospectId, kind, summary, detail, actor: "owner",
  });
  if (error) console.error(`Insurance activity not recorded: ${error.message}`);
}

export async function POST(req: NextRequest) {
  const db = insuranceDb();
  try {
    const raw = await req.text();
    if (raw.length > 20000) throw new InsuranceInputError("Request is too large");
    const body = JSON.parse(raw);
    const action = String(body.action || "");

    // ── settings ───────────────────────────────────────────────────────────
    if (action === "settings") {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const flag of ["enabled", "sending_enabled", "autopilot"]) {
        if (typeof body[flag] === "boolean") updates[flag] = body[flag];
      }
      if (body.min_score != null) {
        const value = Number(body.min_score);
        if (!Number.isInteger(value) || value < 0 || value > 100) throw new InsuranceInputError("Minimum score must be 0–100");
        updates.min_score = value;
      }
      if (body.daily_send_cap != null) {
        const value = Number(body.daily_send_cap);
        if (!Number.isInteger(value) || value < 1 || value > 100) throw new InsuranceInputError("Daily cap must be 1–100");
        updates.daily_send_cap = value;
      }
      if (body.sequence_gap_days != null) {
        const value = Number(body.sequence_gap_days);
        if (!Number.isInteger(value) || value < 1 || value > 30) throw new InsuranceInputError("Sequence gap must be 1–30 days");
        updates.sequence_gap_days = value;
      }
      if (Array.isArray(body.tracks)) {
        const tracks = body.tracks.filter((t: unknown) => t === "recruiting" || t === "buyers");
        if (!tracks.length) throw new InsuranceInputError("Keep at least one track");
        updates.tracks = tracks;
      }
      if (Array.isArray(body.states)) {
        const states = body.states.filter((s: unknown) => typeof s === "string" && ["AZ", "SC", "VA", "OH", "MI"].includes(s));
        if (!states.length) throw new InsuranceInputError("Keep at least one state");
        updates.states = states;
      }
      if (Array.isArray(body.queries)) {
        updates.queries = body.queries
          .filter((q: any) => q && (q.track === "recruiting" || q.track === "buyers") && typeof q.query === "string")
          .slice(0, 40)
          .map((q: any) => ({ track: q.track, query: q.query.slice(0, 160) }));
      }
      const { data, error } = await db.from("insurance_settings").update(updates).eq("id", "owner").select("*").single();
      if (error) throw new Error(`Could not save insurance settings: ${error.message}`);
      return NextResponse.json({ settings: data });
    }

    // ── run a pipeline phase by hand ───────────────────────────────────────
    if (action === "run") {
      const settings = await insuranceSettings();
      const phase = String(body.phase || "");
      if (phase === "discover") return NextResponse.json({ result: await discoverInsuranceProspects(settings) });
      if (phase === "enrich") return NextResponse.json({ result: await enrichInsuranceProspects(6) });
      if (phase === "qualify") return NextResponse.json({ result: await qualifyInsuranceProspects(5) });
      if (phase === "send") return NextResponse.json({ result: await sendInsuranceOutreach(settings, 5) });
      throw new InsuranceInputError("Unknown phase");
    }

    // ── everything else needs a record ─────────────────────────────────────
    if (typeof body.id !== "string" || !UUID.test(body.id)) throw new InsuranceInputError("Invalid prospect ID");
    const { data: prospect, error: readError } = await db.from("insurance_prospects").select("*").eq("id", body.id).single();
    if (readError || !prospect) throw new InsuranceInputError("That prospect no longer exists");

    if (action === "stage") {
      const stage = String(body.stage || "");
      if (!(STAGES[prospect.track as InsuranceTrack] as readonly string[]).includes(stage)) {
        throw new InsuranceInputError("Invalid pipeline stage");
      }
      const closing = stage === "Do not contact";
      const now = new Date().toISOString();
      const { data, error } = await db.from("insurance_prospects").update({
        stage,
        ...(closing ? { opt_out: true, suppression_reason: "marked Do not contact by the owner", suppressed_at: now } : {}),
        updated_at: now,
      }).eq("id", prospect.id).select("*").single();
      if (error) throw new Error(`Could not move this record: ${error.message}`);
      if (closing) {
        await db.from("insurance_tasks").update({ status: "cancelled", completed_at: now, notes: "Cancelled: marked Do not contact" })
          .eq("prospect_id", prospect.id).eq("status", "pending");
      }
      await note(prospect.id, "stage", `Moved to ${stage}`, { from: prospect.stage, to: stage });
      return NextResponse.json({ prospect: data });
    }

    if (action === "note") {
      const text = String(body.note || "").trim();
      if (!text || text.length > 4000) throw new InsuranceInputError("A note must be 1–4000 characters");
      await note(prospect.id, "note", text);
      const { error } = await db.from("insurance_prospects").update({ updated_at: new Date().toISOString() }).eq("id", prospect.id);
      if (error) throw new Error(`Could not touch the record: ${error.message}`);
      return NextResponse.json({ ok: true });
    }

    if (action === "preview") {
      const rendered = renderInsuranceEmail(prospect);
      const settings = await insuranceSettings();
      return NextResponse.json({
        preview: { subject: rendered.subject, body: rendered.messageText, touch: rendered.touch },
        refusal: sendRefusal(prospect, settings.min_score),
      });
    }

    if (action === "send") {
      const settings = await insuranceSettings();
      if (!settings.sending_enabled) throw new InsuranceInputError("Turn sending on before mailing anyone");
      const outcome = await sendInsuranceTouch(prospect, {
        dailyCap: settings.daily_send_cap,
        minScore: settings.min_score,
        source: "owner",
      });
      if (!outcome.sent) return NextResponse.json({ error: `Not sent: ${outcome.reason}` }, { status: 409 });
      return NextResponse.json({ sent: true, touch: outcome.touch });
    }

    if (action === "qualify") {
      const result = await qualifyInsuranceProspects(1);
      return NextResponse.json({ result });
    }

    if (action === "task") {
      if (typeof body.task_id !== "string" || !UUID.test(body.task_id)) throw new InsuranceInputError("Invalid task ID");
      const status = String(body.status || "");
      if (!["completed", "skipped", "cancelled"].includes(status)) throw new InsuranceInputError("Invalid task status");
      const { error } = await db.from("insurance_tasks")
        .update({ status, completed_at: new Date().toISOString(), notes: String(body.notes || "").slice(0, 500) })
        .eq("id", body.task_id).eq("prospect_id", prospect.id);
      if (error) throw new Error(`Could not update the task: ${error.message}`);
      await note(prospect.id, "task", `Task marked ${status}`);
      return NextResponse.json({ ok: true });
    }

    throw new InsuranceInputError("Unknown action");
  } catch (error) {
    const invalid = error instanceof InsuranceInputError || error instanceof SyntaxError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Action failed" },
      { status: invalid ? 400 : 503 }
    );
  }
}
