import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("id, business_name, contact_name, email, status")
      .in("status", ["Booked", "Onboarding Sent", "Onboarding Completed"])
      .eq("opt_out", false)
      .order("meeting_date", { ascending: true })
      .limit(50);

    if (error) throw error;
    return Response.json((data || []).map((lead) => ({
      ...lead,
      onboarding_sent: lead.status === "Onboarding Sent" || lead.status === "Onboarding Completed",
      onboarding_completed: lead.status === "Onboarding Completed",
    })));
  } catch (error) {
    console.error("Onboarding error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load onboarding queue" },
      { status: 500 }
    );
  }
}
