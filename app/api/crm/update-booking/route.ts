import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { bookingId, status } = await req.json();

    // Read the prior value + lead_id so the audit row is complete.
    const { data: existing } = await supabase
      .from("booking_tracker")
      .select("lead_id, booking_status")
      .eq("id", bookingId)
      .single();

    const update: any = { booking_status: status };
    if (status === "Booked") {
      update.booked_at = new Date().toISOString();
    }

    await supabase.from("booking_tracker").update(update).eq("id", bookingId);

    if (existing?.lead_id) {
      await logStatusChange({
        leadId: existing.lead_id,
        field: "booking_status",
        from: existing.booking_status ?? null,
        to: status,
        source: "owner",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update booking error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
