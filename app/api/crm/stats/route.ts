import { createClient } from "@supabase/supabase-js";
import { computeLeadDashboardStats } from "@/lib/lead-stats";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // One leads read → all lead-derived numbers come from the shared
    // lib/lead-stats definitions (same logic the leads workspace uses).
    // The three non-lead queues live in other tables, so they stay as counts.
    const [leadsRes, replies, dmQ, bookings] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "status, email, phone, opt_out, bounced, meeting_booked, meeting_date, created_at"
        ),

      supabase
        .from("outreach_log")
        .select("id", { count: "exact", head: true })
        .not("replied_at", "is", null),

      supabase
        .from("lead_socials")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),

      supabase
        .from("booking_tracker")
        .select("id", { count: "exact", head: true })
        .neq("booked_at", null),
    ]);

    const leadStats = computeLeadDashboardStats(leadsRes.data || []);
    const repliesCount = replies.count || 0;

    return Response.json({
      // Per-queue pending counts (drive the queue cards + dynamic primary CTA).
      emailQueue: leadStats.emailQueue,
      callQueue: leadStats.callQueue,
      dmQueue: dmQ.count || 0,
      replies: repliesCount,
      bookings: bookings.count || 0,
      onboarding: leadStats.onboarding,
      // Today-scoped headline numbers.
      actionToday: repliesCount + leadStats.callQueue,
      meetingsToday: leadStats.meetingsToday,
      newLeads: leadStats.newLeads,
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
      actionToday: 0,
      meetingsToday: 0,
      newLeads: 0,
    });
  }
}
