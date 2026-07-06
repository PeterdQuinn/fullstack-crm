import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Returns leads that have social profiles to DM, grouped by lead, with the
// lead's phone + email attached so you can call/email as well as DM.
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("lead_socials")
      .select("id, lead_id, platform, url, username, is_active, leads(business_name, contact_name, phone, email)")
      .eq("is_active", true)
      .limit(200);

    if (error) throw error;

    const byLead = new Map<string, any>();
    for (const s of data || []) {
      const lead = Array.isArray((s as any).leads) ? (s as any).leads[0] : (s as any).leads;
      if (!s.lead_id) continue;
      if (!byLead.has(s.lead_id)) {
        byLead.set(s.lead_id, {
          id: s.lead_id,
          business_name: lead?.business_name || "Unknown business",
          contact_name: lead?.contact_name || null,
          phone: lead?.phone || null,
          email: lead?.email || null,
          socials: [],
        });
      }
      byLead.get(s.lead_id).socials.push({ platform: s.platform, url: s.url, username: s.username });
    }

    return Response.json([...byLead.values()]);
  } catch (error) {
    console.error("DM queue error:", error);
    return Response.json([]);
  }
}
