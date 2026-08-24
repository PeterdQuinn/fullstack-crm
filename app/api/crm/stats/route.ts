import { computeLeadDashboardStats } from "@/lib/lead-stats";
import { requireTenant, tenantScope, TenantResolutionError } from "@/lib/tenant";


// serviceClient()'s no-store fetch + these keep the counts live, not served
// from Next's fetch cache after leads change.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    // Built per request, never at module scope: a module-scope client is shared
    // across every request a warm lambda serves, so it cannot carry the caller's
    // tenant. The no-store fetch that used to live here is now in serviceClient().
    const tenant = await requireTenant(req);
    const supabase = tenantScope(tenant.id);
    // One leads read → all lead-derived numbers come from the shared
    // lib/lead-stats definitions (same logic the leads workspace uses).
    // The three non-lead queues live in other tables, so they stay as counts.
    const [leadsRes, replies] = await Promise.all([
      supabase
        .from("leads")
        .select(
          "status, email, phone, opt_out, bounced, meeting_booked, meeting_date, created_at"
        ),

      supabase
        .from("outreach_log")
        .select("id", { count: "exact", head: true })
        .not("replied_at", "is", null),

    ]);

    if (leadsRes.error) throw leadsRes.error;
    if (replies.error) throw replies.error;

    const leadStats = computeLeadDashboardStats(leadsRes.data || []);
    const repliesCount = replies.count || 0;
    const bookingStatuses = new Set(["Booking Link Sent", "Booked", "Onboarding Sent", "Onboarding Completed"]);
    const bookingsCount = (leadsRes.data || []).filter((lead: any) =>
      lead.meeting_booked === true || bookingStatuses.has(lead.status || "")
    ).length;
    const researchStatuses = new Set(["New", "Needs Data", "Ready for AI Summary", "Scored"]);
    const researchCount = (leadsRes.data || []).filter((lead: any) => researchStatuses.has(lead.status || "") && !lead.opt_out).length;

    return Response.json({
      // Per-queue pending counts (drive the queue cards + dynamic primary CTA).
      emailQueue: leadStats.emailQueue,
      callQueue: leadStats.callQueue,
      dmQueue: researchCount,
      replies: repliesCount,
      bookings: bookingsCount,
      onboarding: leadStats.onboarding,
      // Today-scoped headline numbers.
      actionToday: repliesCount + leadStats.callQueue,
      meetingsToday: leadStats.meetingsToday,
      newLeads: leadStats.newLeads,
    });
  } catch (error) {
    // A request that cannot name its tenant is 401/402, not 500 — and must not
    // fall through to an unscoped read.
    if (error instanceof TenantResolutionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Stats error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard statistics" },
      { status: 500 }
    );
  }
}
