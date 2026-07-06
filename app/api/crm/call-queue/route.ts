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
      .select("id, business_name, contact_name, phone, status")
      .neq("phone", null)
      .neq("phone", "")
      .in("status", ["Call Needed", "Ready for Outreach"])
      .limit(50);

    if (error) throw error;
    return Response.json(data || []);
  } catch (error) {
    console.error("Call queue error:", error);
    return Response.json([]);
  }
}
