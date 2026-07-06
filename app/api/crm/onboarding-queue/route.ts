import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("booking_tracker")
      .select(`id, lead_id, onboarding_sent, onboarding_completed, leads(business_name, contact_name, email)`)
      .eq("booked_at", true)
      .limit(50);

    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    console.error("Onboarding error:", error);
    return Response.json([]);
  }
}
