import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json();

    // Capture prior status for the audit trail before overwriting it.
    const { data: lead } = await supabase.from("leads").select("status").eq("id", leadId).single();

    await supabase
      .from("booking_tracker")
      .update({ onboarding_completed: true })
      .eq("lead_id", leadId);

    await supabase.from("leads").update({ status: "Onboarding Completed" }).eq("id", leadId);

    await logStatusChange({
      leadId,
      field: "status",
      from: lead?.status ?? null,
      to: "Onboarding Completed",
      source: "owner",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Onboarding completed error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
