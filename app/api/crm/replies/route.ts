import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


export const dynamic = "force-dynamic";

// Shape returned to /crm/replies. The page renders `company` and `message`, so
// the business name is joined in from `leads` (FK: outreach_log.lead_id) and
// `message_body` is aliased to `message` — previously the route returned raw
// column names and every card rendered blank.
interface ReplyRow {
  id: string;
  lead_id: string;
  company: string;
  contact: string | null;
  message: string;
  status: string | null;
  replied_at: string | null;
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("outreach_log")
      .select(
        "id, lead_id, message:message_body, replied_at, leads(business_name, owner_name, status)"
      )
      .not("replied_at", "is", null)
      .order("replied_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // Flatten the embedded lead so the client gets a flat record. supabase-js
    // types the embed as either an object or a single-element array depending
    // on how it infers the relationship, so handle both.
    const rows: ReplyRow[] = (data || []).map((r: any) => {
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
      return {
        id: r.id,
        lead_id: r.lead_id,
        company: lead?.business_name || "(unknown business)",
        contact: lead?.owner_name || null,
        message: r.message || "",
        status: lead?.status ?? null,
        replied_at: r.replied_at ?? null,
      };
    });

    return Response.json(rows);
  } catch (error) {
    console.error("Replies error:", error);
    return Response.json([]);
  }
}
