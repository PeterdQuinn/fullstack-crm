import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { bookingId, status } = await req.json();

    const update: any = { booking_status: status };
    if (status === "Booked") {
      update.booked_at = new Date().toISOString();
    }

    await supabase.from("booking_tracker").update(update).eq("id", bookingId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update booking error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
