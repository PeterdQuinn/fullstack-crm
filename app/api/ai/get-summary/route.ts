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
      .from("lead_ai_summaries")
      .select("*")
      .eq("lead_id", leadId)
      .single();

    if (error) {
      return Response.json(null);
    }

    return Response.json(data);
  } catch (error) {
    console.error("Get summary error:", error);
    return Response.json(null);
  }
}
