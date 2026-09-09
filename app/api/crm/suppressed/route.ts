import { createClient } from "@supabase/supabase-js";
import { EMAIL_FAILURE_STATUS, isPermanentlySuppressed, isPhoneReachable, suppressionReasons } from "@/lib/suppression";

// Suppressed leads, split by whether anything can still be done with them.
//
// This used to select on the bounced/complained/opt_out flags alone, which
// missed every lead whose address was rejected before a send ever happened —
// they sit at status "Bad Email" with no flag set. On live data that hid 15 of
// 24 unusable-address leads from the only page meant to show them.

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
        "id, business_name, contact_name, owner_name, email, phone, website, status, status_before_suppression, opt_out, bounced, complained, updated_at"
      )
      .or(`bounced.eq.true,complained.eq.true,opt_out.eq.true,status.eq.${EMAIL_FAILURE_STATUS}`)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const rows = (data || []).map((l) => {
      const permanent = isPermanentlySuppressed(l);
      return {
        id: l.id,
        company: l.business_name,
        contact: l.contact_name || l.owner_name || null,
        email: l.email || null,
        phone: l.phone || null,
        website: l.website || null,
        reasons: suppressionReasons(l),
        date_flagged: l.updated_at || null,
        original_status: l.status_before_suppression || null,
        current_status: l.status || null,
        // Permanent means a person asked to be left alone. Everything else is
        // just a dead address on a business that may still answer the phone.
        permanent,
        callable: !permanent && isPhoneReachable(l),
      };
    });

    return Response.json({
      rows,
      summary: {
        total: rows.length,
        permanent: rows.filter((r) => r.permanent).length,
        emailOnly: rows.filter((r) => !r.permanent).length,
        callable: rows.filter((r) => r.callable).length,
      },
    });
  } catch (error) {
    console.error("Suppressed leads error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load suppressed leads" },
      { status: 500 }
    );
  }
}
