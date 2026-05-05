import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("outreach_log")
      .select("id, lead_id, message_body, replied_at")
      .not("replied_at", "is", null)
      .limit(50);

    if (error) throw error;

    return Response.json(data || []);
  } catch (error) {
    console.error("Replies error:", error);
    return Response.json([]);
  }
}
