import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: leads, error } = await supabase
      .from("leads")
      .select(`
        id,
        business_name,
        phone,
        email,
        owner_name,
        website,
        address,
        city,
        state,
        niche,
        industry,
        linkedin_url,
        facebook_url,
        twitter_url,
        status,
        email_sent_count,
        created_at,
        lead_ai_summaries (
          lead_score,
          confidence_level,
          main_pain_point,
          best_attack_angle,
          missing_data_needed
        ),
        lead_socials (
          platform,
          url,
          username,
          is_active
        ),
        outreach_log (
          channel,
          sent_at,
          opened_at,
          replied_at,
          message_body
        ),
        booking_tracker (
          booking_status,
          booked_at
        )
      `)
      .eq("status", "New")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase error:", error);
      return Response.json({ leads: [], error: error.message }, { status: 500 });
    }

    return Response.json({ leads: leads || [] });
  } catch (error) {
    console.error("Error fetching discovered leads:", error);
    return Response.json({ leads: [], error: String(error) }, { status: 500 });
  }
}
