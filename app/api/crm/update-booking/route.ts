import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_STATUSES = new Set(["Booking Link Sent", "Booked", "Onboarding Sent", "Onboarding Completed"]);

export async function POST(req: NextRequest) {
  try {
    const { bookingId, status } = await req.json();
    if (!bookingId || !ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid lead id or booking status" }, { status: 400 });
    }

    // Booking rows shown by the UI are lead rows, so update that same source of
    // truth. The previous implementation wrote to booking_tracker using a lead
    // id as the tracker id and could return success after updating zero rows.
    const { data: existing, error: readError } = await supabase
      .from("leads")
      .select("id, status, meeting_booked")
      .eq("id", bookingId)
      .single();
    if (readError || !existing) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const update = {
      status,
      meeting_booked: status !== "Booking Link Sent",
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await supabase
      .from("leads")
      .update(update)
      .eq("id", bookingId)
      .select("id")
      .single();
    if (updateError || !updated) throw new Error(updateError?.message || "Booking update changed no rows");

    await logStatusChange({
      leadId: existing.id,
      field: "status",
      from: existing.status ?? null,
      to: status,
      source: "owner",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update booking error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
