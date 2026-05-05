import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const [emailQ, replies, callQ, dmQ, bookings, onboarding] = await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("opt_out", false)
        .eq("bounced", false)
        .neq("status", "Do Not Contact")
        .in("status", ["Ready for Outreach", "Email 1 Sent", "Email 2 Sent"])
        .not("email", "is", null)
        .neq("email", ""),

      supabase.from("outreach_log").select("id", { count: "exact", head: true }).eq("replied_at", null),

      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .neq("phone", null)
        .neq("phone", "")
        .in("status", ["Call Needed", "Ready for Outreach"]),

      supabase
        .from("lead_socials")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),

      supabase
        .from("booking_tracker")
        .select("id", { count: "exact", head: true })
        .neq("booked_at", null),

      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("meeting_booked", true)
        .eq("opt_out", false),
    ]);

    return Response.json({
      emailQueue: emailQ.count || 0,
      callQueue: callQ.count || 0,
      dmQueue: dmQ.count || 0,
      replies: replies.count || 0,
      bookings: bookings.count || 0,
      onboarding: onboarding.count || 0,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return Response.json({
      emailQueue: 0,
      callQueue: 0,
      dmQueue: 0,
      replies: 0,
      bookings: 0,
      onboarding: 0,
    });
  }
}
