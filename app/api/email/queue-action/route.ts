import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ACTIONS = ["skip", "move_to_calls", "bad_email", "do_not_contact"] as const;
type QueueAction = typeof ACTIONS[number];

export async function POST(req: NextRequest) {
  try {
    const { leadId, action } = await req.json();
    if (!leadId || !ACTIONS.includes(action as QueueAction)) {
      return NextResponse.json({ error: "A valid lead and action are required" }, { status: 400 });
    }

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("status, opt_out")
      .eq("id", leadId)
      .single();
    if (leadError || !lead) return NextResponse.json({ error: "Lead was not found" }, { status: 404 });
    if ((lead.opt_out || lead.status === "Do Not Contact") && action !== "do_not_contact") {
      return NextResponse.json({ error: "This lead is suppressed and cannot enter an outreach workflow" }, { status: 409 });
    }

    let updates: Record<string, unknown>;
    let reason: string;
    if (action === "skip") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      updates = { status: "Follow-Up Scheduled", next_follow_up_at: tomorrow.toISOString() };
      reason = "Email review skipped until tomorrow";
    } else if (action === "move_to_calls") {
      updates = { status: "Call Needed", next_follow_up_at: null };
      reason = "Moved from email review to calls";
    } else if (action === "bad_email") {
      updates = { status: "Bad Email", next_follow_up_at: null };
      reason = "Email address marked bad by owner";
    } else {
      updates = {
        status: "Do Not Contact",
        opt_out: true,
        next_follow_up_at: null,
        ...(lead.opt_out ? {} : { status_before_suppression: lead.status }),
      };
      reason = "Contact suppressed by owner";
    }

    const newStatus = String(updates.status);
    const { error: updateError } = await supabase
      .from("leads")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
    await logStatusChange({ leadId, from: lead.status, to: newStatus, source: "owner", reason });
    if (action === "do_not_contact") {
      await supabase.from("follow_up_tasks").update({ status: "cancelled", completed_at: new Date().toISOString(), notes: "Cancelled because contact was suppressed" }).eq("lead_id", leadId).eq("status", "pending");
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error("Email queue action error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update the lead" },
      { status: 500 }
    );
  }
}
