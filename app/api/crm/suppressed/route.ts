import { createClient } from "@supabase/supabase-js";

// Read-only list of suppressed leads: anyone flagged bounced, complained, or
// opt_out. Backs the /crm/suppressed view.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } }
);

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, business_name, contact_name, owner_name, email, status, status_before_suppression, opt_out, bounced, complained, updated_at"
      )
      .or("bounced.eq.true,complained.eq.true,opt_out.eq.true")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const rows = (data || []).map((l) => {
      const reasons: string[] = [];
      if (l.bounced) reasons.push("bounced");
      if (l.complained) reasons.push("complained");
      if (l.opt_out) reasons.push("opt_out");
      return {
        id: l.id,
        company: l.business_name,
        contact: l.contact_name || l.owner_name || null,
        email: l.email || null,
        reasons,
        date_flagged: l.updated_at || null,
        original_status: l.status_before_suppression || null,
        current_status: l.status || null,
      };
    });

    return Response.json(rows);
  } catch (error) {
    console.error("Suppressed leads error:", error);
    return Response.json([], { status: 200 });
  }
}
