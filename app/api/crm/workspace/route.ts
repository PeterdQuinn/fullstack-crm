import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function failure(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");

  if (leadId) {
    const [calls, notes, appointments] = await Promise.all([
      supabase.from("call_logs").select("*").eq("lead_id", leadId).order("called_at", { ascending: false }),
      supabase.from("lead_notes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
      supabase.from("appointments").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
    ]);
    const error = calls.error || notes.error || appointments.error;
    if (error) return failure("Could not load lead activity");
    return NextResponse.json({ callLogs: calls.data || [], notes: notes.data || [], appointments: appointments.data || [] });
  }

  const [leads, summaries] = await Promise.all([
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("lead_ai_summaries").select("lead_id, lead_score"),
  ]);
  const error = leads.error || summaries.error;
  if (error) return failure("Could not load the workspace");

  const scores: Record<string, number> = {};
  for (const summary of summaries.data || []) {
    if (summary.lead_score) scores[summary.lead_id] = summary.lead_score;
  }
  return NextResponse.json({ leads: leads.data || [], scores });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "update_lead") {
      if (!body.id || !body.updates || typeof body.updates !== "object") return failure("Lead and updates are required", 400);
      const { data: current, error: readError } = await supabase.from("leads").select("status, opt_out, bounced, complained").eq("id", body.id).single();
      if (readError) return failure("Lead was not found", 404);
      const { id: ignoredId, created_at: ignoredCreated, ...updates } = body.updates;
      if ((current.opt_out || current.status === "Do Not Contact" || current.bounced || current.complained) &&
          (updates.opt_out === false || updates.status && updates.status !== "Do Not Contact")) {
        return failure("This lead is suppressed. Restore requires a dedicated reviewed action.", 409);
      }
      const { error } = await supabase.from("leads").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", body.id);
      if (error) return failure("Could not update the lead");
      if (updates.status && updates.status !== current.status) {
        await logStatusChange({ leadId: body.id, from: current.status, to: updates.status, source: "owner" });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "add_call" || action === "add_note" || action === "add_appointment") {
      const table = action === "add_call" ? "call_logs" : action === "add_note" ? "lead_notes" : "appointments";
      if (!body.entry?.lead_id) return failure("Lead is required", 400);
      if (action === "add_call") {
        const { data: lead } = await supabase.from("leads").select("status, opt_out, bounced, complained").eq("id", body.entry.lead_id).maybeSingle();
        if (!lead || lead.opt_out || lead.status === "Do Not Contact" || lead.bounced || lead.complained) {
          return failure("This lead is suppressed and cannot be contacted", 409);
        }
      }
      const { error } = await supabase.from(table).insert(body.entry);
      if (error) return failure("Could not save the activity");
      return NextResponse.json({ success: true });
    }

    if (action === "add_leads") {
      if (!Array.isArray(body.leads) || body.leads.length === 0) return failure("At least one lead is required", 400);
      const { error } = await supabase.from("leads").insert(body.leads);
      if (error) return failure("Could not add the leads");
      return NextResponse.json({ success: true });
    }

    if (action === "delete_leads") {
      if (!Array.isArray(body.ids) || body.ids.length === 0) return failure("Lead identifiers are required", 400);
      const { error } = await supabase.from("leads").delete().in("id", body.ids);
      if (error) return failure("Could not delete the leads");
      return NextResponse.json({ success: true });
    }

    if (action === "delete_all") {
      const { error } = await supabase.from("leads").delete().not("id", "is", null);
      if (error) return failure("Could not delete the leads");
      return NextResponse.json({ success: true });
    }

    return failure("Unknown workspace action", 400);
  } catch (error) {
    console.error("workspace error:", error);
    return failure("Workspace request failed");
  }
}
