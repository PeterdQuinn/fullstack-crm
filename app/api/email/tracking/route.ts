import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("leadId");

    if (!leadId) {
      return Response.json({ error: "No leadId" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("outreach_log")
      .select("*")
      .eq("lead_id", leadId)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .order("sent_at", { ascending: false });

    if (error) {
      console.error("Tracking error:", error);
      return Response.json([]);
    }

    return Response.json(data || []);
  } catch (error) {
    console.error("Tracking error:", error);
    return Response.json([]);
  }
}
