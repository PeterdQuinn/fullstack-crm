import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";
import { CALL_OUTCOMES, type CallOutcome, type LeadStatus } from "@/lib/types";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OUTCOME_STATUS: Record<CallOutcome, LeadStatus> = {
  "No answer": "No Answer",
  "Left voicemail": "Follow-Up Scheduled",
  "Spoke with gatekeeper": "Follow-Up Scheduled",
  "Spoke with owner": "Called",
  "Callback requested": "Follow-Up Scheduled",
  "Not interested": "Dead",
  Interested: "Interested",
  "Booked meeting": "Booked",
};

function automaticFollowUp(outcome: CallOutcome) {
  const days = outcome === "No answer" || outcome === "Spoke with gatekeeper" ? 1
    : outcome === "Left voicemail" || outcome === "Callback requested" ? 2
    : 0;
  if (!days) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const { leadId, outcome, notes, followUpAt } = await req.json();
    if (!leadId || !CALL_OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: "A valid lead and call outcome are required" }, { status: 400 });
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("status, opt_out, bounced, complained")
      .eq("id", leadId)
      .single();
    if (leadError || !lead) return NextResponse.json({ error: "Lead was not found" }, { status: 404 });
    if (lead.opt_out || lead.status === "Do Not Contact" || lead.bounced || lead.complained) {
      return NextResponse.json({ error: "This lead is suppressed and cannot be contacted" }, { status: 409 });
    }

    const calledAt = new Date().toISOString();
    const nextFollowUp = followUpAt || automaticFollowUp(outcome);
    const newStatus = OUTCOME_STATUS[outcome as CallOutcome];

    const { error: callError } = await supabase.from("call_logs").insert({
      lead_id: leadId,
      outcome,
      notes: typeof notes === "string" ? notes.trim() : "",
      called_at: calledAt,
      next_follow_up_at: nextFollowUp,
    });
    if (callError) throw new Error(`Could not save call history: ${callError.message}`);

    const { error: updateError } = await supabase
      .from("leads")
      .update({
        status: newStatus,
        last_called_at: calledAt,
        next_follow_up_at: nextFollowUp,
        ...(outcome === "Booked meeting" ? { meeting_booked: true } : {}),
      })
      .eq("id", leadId);
    if (updateError) throw new Error(`Could not update lead: ${updateError.message}`);

    await logStatusChange({ leadId, field: "status", from: lead.status, to: newStatus, source: "owner" });
    return NextResponse.json({ success: true, status: newStatus, nextFollowUpAt: nextFollowUp });
  } catch (error) {
    console.error("Log call error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the call" },
      { status: 500 }
    );
  }
}
