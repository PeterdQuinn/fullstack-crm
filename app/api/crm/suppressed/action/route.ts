import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";
import { isPermanentlySuppressed } from "@/lib/suppression";

// Actions on a suppressed lead.
//
// The page was a read-only list, which meant reading it changed nothing: the 24
// leads with a dead address and a working phone stayed exactly where they were.
// These are the three things worth doing, and none of them can touch a lead
// whose owner asked to be left alone.

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export const dynamic = "force-dynamic";

type Action = "call" | "find_address" | "retry_email";
const ACTIONS: Action[] = ["call", "find_address", "retry_email"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as Action;
    const leadId = typeof body.leadId === "string" ? body.leadId : "";
    if (!leadId || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Choose a lead and one of: call, find_address, retry_email" }, { status: 400 });
    }

    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, business_name, status, phone, email, website, opt_out, bounced, complained, suppression_kind")
      .eq("id", leadId).is("archived_at", null).single();
    if (error || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    // A request to stop is not undoable from a dashboard button.
    if (isPermanentlySuppressed(lead)) {
      return NextResponse.json({ error: "This person asked not to be contacted. That cannot be reversed here." }, { status: 409 });
    }

    if (action === "call") {
      if (!lead.phone?.trim()) return NextResponse.json({ error: "No phone number on file for this lead" }, { status: 400 });
      const { error: saveError } = await supabase.from("leads")
        .update({ status: "Call Needed", updated_at: new Date().toISOString() }).eq("id", leadId);
      if (saveError) throw new Error(saveError.message);
      await logStatusChange({ leadId, from: lead.status, to: "Call Needed", source: "owner", reason: "Email unusable; moved to the call queue" });
      return NextResponse.json({ ok: true, message: `${lead.business_name} moved to the call queue` });
    }

    if (action === "find_address") {
      if (!lead.website?.trim()) return NextResponse.json({ error: "No website to search for a new address" }, { status: 400 });
      // Clearing the address is what puts the lead back in front of enrichment:
      // enrichLeadsBatch selects on a website present and an email missing.
      const { error: saveError } = await supabase.from("leads").update({
        email: null, bounced: false, status: "Scored",
        suppression_kind: null, suppression_reason: null, suppressed_at: null,
        updated_at: new Date(0).toISOString(),
      }).eq("id", leadId);
      if (saveError) throw new Error(saveError.message);
      await logStatusChange({ leadId, from: lead.status, to: "Scored", source: "owner", reason: "Bad address cleared; queued to find another" });
      return NextResponse.json({ ok: true, message: `Looking for a new address for ${lead.business_name}` });
    }

    // retry_email: only ever for a failure we recorded as temporary.
    if (lead.suppression_kind !== "transient") {
      return NextResponse.json({ error: "Only a temporary failure can be retried. Find a new address instead." }, { status: 409 });
    }
    const { error: saveError } = await supabase.from("leads").update({
      bounced: false, status: "Ready for Outreach",
      suppression_kind: null, suppression_reason: null, suppressed_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", leadId);
    if (saveError) throw new Error(saveError.message);
    await logStatusChange({ leadId, from: lead.status, to: "Ready for Outreach", source: "owner", reason: "Temporary delivery failure; returned to outreach" });
    return NextResponse.json({ ok: true, message: `${lead.business_name} returned to outreach` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
