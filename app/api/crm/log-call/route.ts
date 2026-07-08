import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { leadId, outcome, notes } = await req.json();

    const { data: lead } = await supabase.from("leads").select("status").eq("id", leadId).single();

    await supabase.from("call_logs").insert({
      lead_id: leadId,
      outcome,
      notes,
      called_at: new Date().toISOString(),
    });

    await supabase
      .from("leads")
      .update({ status: "Called", last_called_at: new Date().toISOString() })
      .eq("id", leadId);

    await logStatusChange({
      leadId,
      field: "status",
      from: lead?.status ?? null,
      to: "Called",
      source: "owner", // logged from the call-queue UI
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Log call error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
