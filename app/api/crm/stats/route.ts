import { createClient } from "@supabase/supabase-js";
import { computeLeadDashboardStats } from "@/lib/lead-stats";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } }
);


// no-store fetch (above) + these keep the counts live, not served from Next's
// fetch cache after leads change.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    // One leads read → all lead-derived numbers come from the shared
    // lib/lead-stats definitions (same logic the leads workspace uses).
    // The three non-lead queues live in other tables, so they stay as counts.
    const [leadsRes, replies, dmQ] = await Promise.all([
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

    ]);

    if (leadsRes.error) throw leadsRes.error;
    if (replies.error) throw replies.error;
    if (dmQ.error) throw dmQ.error;

    const leadStats = computeLeadDashboardStats(leadsRes.data || []);
    const repliesCount = replies.count || 0;
    const bookingStatuses = new Set(["Booking Link Sent", "Booked", "Onboarding Sent", "Onboarding Completed"]);
    const bookingsCount = (leadsRes.data || []).filter((lead) =>
      lead.meeting_booked === true || bookingStatuses.has(lead.status || "")
    ).length;

    return Response.json({
      // Per-queue pending counts (drive the queue cards + dynamic primary CTA).
      emailQueue: leadStats.emailQueue,
      callQueue: leadStats.callQueue,
      dmQueue: dmQ.count || 0,
      replies: repliesCount,
      bookings: bookingsCount,
      onboarding: leadStats.onboarding,
      // Today-scoped headline numbers.
      actionToday: repliesCount + leadStats.callQueue,
      meetingsToday: leadStats.meetingsToday,
      newLeads: leadStats.newLeads,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard statistics" },
      { status: 500 }
    );
  }
}
