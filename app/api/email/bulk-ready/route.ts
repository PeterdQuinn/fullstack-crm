import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  try {
    const { data: leads, error: fetchError } = await supabase
      .from("leads")
      .select("id")
      .notIn("status", ["Dead", "Do Not Contact", "Bad Email"]);

    if (fetchError) throw fetchError;

    const leadIds = leads?.map(l => l.id) || [];
    console.log(`Updating ${leadIds.length} leads`);

    const { error, data } = await supabase
      .from("leads")
      .update({ status: "Ready for Outreach" })
      .in("id", leadIds);

    if (error) {
      console.error("Update error:", error);
      throw error;
    }

    console.log("Update result:", data);
    return Response.json({ success: true, updated: leadIds.length, message: "Leads moved to Ready for Outreach" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
