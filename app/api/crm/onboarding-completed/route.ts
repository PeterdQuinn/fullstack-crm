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

    if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });
    const { data: lead, error: readError } = await supabase
      .from("leads").select("id, status").eq("id", leadId).single();
    if (readError || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const { data: updated, error: updateError } = await supabase
      .from("leads")
      .update({ status: "Onboarding Completed", meeting_booked: true, updated_at: new Date().toISOString() })
      .eq("id", leadId)
      .select("id")
      .single();
    if (updateError || !updated) throw new Error(updateError?.message || "Onboarding update changed no rows");

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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
