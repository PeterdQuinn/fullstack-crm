import { createClient } from "@supabase/supabase-js";

// force-dynamic alone is NOT enough: Next.js also caches the fetch() that
// supabase-js makes to PostgREST, so the route would keep serving a stale
// snapshot (missing the newest leads) even though the route itself is dynamic.
// fetchCache + a no-store fetch on the client guarantee every export hits the DB.
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

// RFC-4180 CSV cell escaping: wrap in quotes and double any embedded quote when
// the value contains a comma, quote, or newline.
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  "business_name",
  "phone",
  "email",
  "city",
  "state",
  "website",
  "status",
  "lead_score",
] as const;

export async function GET() {
  try {
    // Fresh query. Exclude opted-out and Do Not Contact leads. lead_score lives
    // on the joined lead_ai_summaries row (left join so unscored leads still
    // export, with a blank score).
    const { data, error } = await supabase
      .from("leads")
      .select(
        "business_name, phone, email, city, state, website, status, opt_out, lead_ai_summaries(lead_score)"
      )
      .eq("opt_out", false)
      .neq("status", "Do Not Contact")
      .order("business_name", { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = (data || []).map((lead) => {
      const summary = Array.isArray(lead.lead_ai_summaries)
        ? lead.lead_ai_summaries[0]
        : lead.lead_ai_summaries;
      return [
        lead.business_name,
        lead.phone,
        lead.email,
        lead.city,
        lead.state,
        lead.website,
        lead.status,
        summary?.lead_score ?? "",
      ];
    });

    const csv = [
      COLUMNS.join(","),
      ...rows.map((r) => r.map(csvCell).join(",")),
    ].join("\r\n");

    const today = new Date().toISOString().split("T")[0];

    // Leading BOM so Excel opens UTF-8 correctly.
    return new Response("﻿" + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Export failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
