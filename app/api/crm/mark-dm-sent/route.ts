import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json();

    const { data: lead } = await supabase.from("leads").select("status, opt_out, bounced, complained").eq("id", leadId).maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead was not found" }, { status: 404 });
    if (lead.opt_out || lead.status === "Do Not Contact" || lead.bounced || lead.complained) {
      return NextResponse.json({ error: "This lead is suppressed and cannot be contacted" }, { status: 409 });
    }

    await supabase.from("outreach_log").insert({
      lead_id: leadId,
      channel: "dm",
      direction: "outbound",
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    await supabase.from("leads").update({ status: "DM Sent" }).eq("id", leadId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DM sent error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
