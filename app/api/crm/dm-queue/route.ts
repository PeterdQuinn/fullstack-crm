import { createClient } from "@supabase/supabase-js";

// force-dynamic + no-store fetch: otherwise Next caches supabase-js's fetch and
// the queue would keep showing links we just deactivated.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  }
);

// Returns leads that have ACTIVE social profiles to DM, grouped by lead, with
// the lead's phone + email + website attached so you can call/email as well as DM.

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("lead_socials")
      .select("id, lead_id, platform, url, username, is_active, leads(business_name, contact_name, phone, email, website, status)")
      .eq("is_active", true)
      .limit(400);

    if (error) throw error;

    const byLead = new Map<string, any>();
    for (const s of data || []) {
      const lead = Array.isArray((s as any).leads) ? (s as any).leads[0] : (s as any).leads;
      if (!s.lead_id) continue;
      // Rotation: drop leads already DM'd (or opted out) so the same ones don't
      // keep reappearing. Marking "DM Sent" removes them from the queue.
      if (lead?.status === "DM Sent" || lead?.status === "Do Not Contact") continue;
      const website = lead?.website && String(lead.website).trim().toUpperCase() !== "N/A" ? lead.website : null;
      if (!byLead.has(s.lead_id)) {
        byLead.set(s.lead_id, {
          id: s.lead_id,
          business_name: lead?.business_name || "Unknown business",
          contact_name: lead?.contact_name || null,
          phone: lead?.phone || null,
          email: lead?.email || null,
          website,
          socials: [],
        });
      }
      // Only surface a social with a usable link (dead/broken ones were flagged
      // is_active=false; this also guards against any blank-url rows).
      if (s.url && String(s.url).trim()) {
        byLead.get(s.lead_id).socials.push({ platform: s.platform, url: s.url, username: s.username });
      }
    }

    return Response.json([...byLead.values()]);
  } catch (error) {
    console.error("DM queue error:", error);
    return Response.json([]);
  }
}
