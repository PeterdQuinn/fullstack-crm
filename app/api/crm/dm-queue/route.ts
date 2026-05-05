import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("lead_socials")
      .select("id, lead_id, platform, url, username, is_active")
      .eq("is_active", true)
      .limit(50);

    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    console.error("DM queue error:", error);
    return Response.json([]);
  }
}
