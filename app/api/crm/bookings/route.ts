import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Booking pipeline sourced from the leads table (the booking_tracker automation
// table is unused). Shows any lead that has booked or is in a booking-related
// stage, with phone + email attached.
const BOOKING_STATUSES = [
  "Booking Link Sent",
  "Booking Follow-Up 1",
  "Booking Follow-Up 2",
  "Booked",
];

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("id, business_name, contact_name, phone, email, status, meeting_booked, meeting_date")
      .or(`meeting_booked.eq.true,status.in.(${BOOKING_STATUSES.join(",")})`)
      .order("meeting_date", { ascending: true })
      .limit(100);

    if (error) throw error;

    return Response.json(
      (data || []).map((l) => ({
        id: l.id,
        business_name: l.business_name,
        contact: l.contact_name || null,
        phone: l.phone || null,
        email: l.email || null,
        status: l.meeting_booked ? "Booked" : l.status,
        booked_at: l.meeting_date || null,
        no_show: false,
      }))
    );
  } catch (error) {
    console.error("Bookings error:", error);
    return Response.json([]);
  }
}
