import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("booking_tracker")
      .select(`
        id, lead_id, booking_status, booked_at, no_show,
        leads(business_name, contact_name, email)
      `)
      .limit(50);

    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    console.error("Bookings error:", error);
    return Response.json([]);
  }
}
