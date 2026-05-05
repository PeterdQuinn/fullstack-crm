import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json();

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
