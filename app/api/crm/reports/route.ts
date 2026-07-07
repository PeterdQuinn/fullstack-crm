import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Terminal-status breakdown for the Reports page. Counts leads that have
// reached an end state, optionally scoped to a recent date window (by
// updated_at — when the lead last changed, i.e. when it landed in that state).

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } }
);

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const TERMINAL_STATUSES = ["Won", "Lost", "Do Not Contact", "Bad Data", "Bad Email", "No Response"] as const;

export async function GET(req: NextRequest) {
  try {
    const range = req.nextUrl.searchParams.get("range") || "all"; // "30" | "90" | "all"

    let query = supabase
      .from("leads")
      .select("status, updated_at")
      .in("status", TERMINAL_STATUSES as unknown as string[]);

    if (range === "30" || range === "90") {
      const days = Number(range);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("updated_at", since);
    }

    const { data, error } = await query;
    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const s of TERMINAL_STATUSES) counts[s] = 0;
    for (const row of data || []) {
      if (row.status in counts) counts[row.status]++;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const breakdown = TERMINAL_STATUSES.map((status) => ({
      status,
      count: counts[status],
      pct: total > 0 ? Math.round((counts[status] / total) * 1000) / 10 : 0,
    }));

    return Response.json({ range, total, breakdown });
  } catch (error) {
    console.error("Reports error:", error);
    return Response.json({ range: "all", total: 0, breakdown: [] }, { status: 200 });
  }
}
