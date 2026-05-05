import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: all, error: allError } = await supabase
    .from("leads")
    .select("id, status, email, opt_out, bounced, email_sent_count")
    .limit(500);

  const statusBreakdown: Record<string, number> = {};
  const readyBreakdown: Record<string, number> = {};

  all?.forEach((lead) => {
    statusBreakdown[lead.status] = (statusBreakdown[lead.status] || 0) + 1;

    const ready = !lead.opt_out && !lead.bounced && lead.email_sent_count < 3 &&
      ["Ready for Outreach", "Email 1 Sent", "Email 2 Sent"].includes(lead.status);

    if (ready) {
      readyBreakdown[lead.status] = (readyBreakdown[lead.status] || 0) + 1;
    }
  });

  return Response.json({
    total: all?.length,
    allStatuses: statusBreakdown,
    readyByStatus: readyBreakdown,
    totalReady: Object.values(readyBreakdown).reduce((a, b) => a + b, 0),
  });
}
