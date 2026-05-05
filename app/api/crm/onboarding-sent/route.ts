import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { leadId } = await req.json();

    await supabase.from("booking_tracker").update({ onboarding_sent: true }).eq("lead_id", leadId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Onboarding sent error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
