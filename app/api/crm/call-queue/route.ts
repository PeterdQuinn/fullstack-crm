import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

const CALL_STATUSES = [
  "Call Needed",
  "Ready for Outreach",
  "No Answer",
  "Follow-Up",
  "Follow-Up Scheduled",
  "Needs Follow-Up",
  "Interested",
];

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select(`
        id, business_name, owner_name, contact_name, phone, email, website,
        address, city, state, postal_code, niche, industry, status,
        short_description, employees, annual_revenue, founded_year,
        current_software, monthly_spend_estimate, pain_point,
        google_rating, google_review_count, last_called_at, next_follow_up_at,
        created_at,
        lead_ai_summaries(lead_score, confidence_level, main_pain_point,
          pain_reason, best_attack_angle, recommended_first_message,
          recommended_follow_up),
        call_logs(id, called_at, outcome, notes, current_software,
          client_acquisition_method, pain_point, next_follow_up_at),
        lead_notes(id, note, created_at)
      `)
      .not("phone", "is", null)
      .neq("phone", "")
      .is("archived_at", null)
      .eq("opt_out", false)
      .in("status", CALL_STATUSES)
      .limit(200);

    if (error) throw error;

    const now = Date.now();
    const rows = (data || []).map((lead: any) => ({
      ...lead,
      ai_summary: Array.isArray(lead.lead_ai_summaries) ? lead.lead_ai_summaries[0] || null : lead.lead_ai_summaries,
      call_logs: [...(lead.call_logs || [])]
        .sort((a: any, b: any) => new Date(b.called_at).getTime() - new Date(a.called_at).getTime())
        .slice(0, 5),
      lead_notes: [...(lead.lead_notes || [])]
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5),
    }));

    rows.sort((a: any, b: any) => {
      const aDue = a.next_follow_up_at ? new Date(a.next_follow_up_at).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.next_follow_up_at ? new Date(b.next_follow_up_at).getTime() : Number.POSITIVE_INFINITY;
      const aOverdue = aDue <= now ? 0 : 1;
      const bOverdue = bDue <= now ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      if (aDue !== bDue) return aDue - bDue;
      return (b.ai_summary?.lead_score || 0) - (a.ai_summary?.lead_score || 0);
    });

    return Response.json(rows);
  } catch (error) {
    console.error("Call queue error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load call queue" },
      { status: 500 }
    );
  }
}
