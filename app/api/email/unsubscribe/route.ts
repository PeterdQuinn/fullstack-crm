import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logStatusChange } from "@/lib/audit";

// Public, unauthenticated endpoint (see middleware.ts). Clicking the
// unsubscribe link in an outbound email lands here and writes opt_out=true
// directly to the lead's row — no manual DB edit required (CAN-SPAM).

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#333;text-align:center;">
<h1 style="font-size:22px;">${title}</h1>
<p style="line-height:1.6;color:#555;">${body}</p>
<p style="color:#999;font-size:12px;margin-top:40px;">Full Stack Services LLC</p>
</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// Accept both param names: the email footer emits `lead_id`, while older links
// already in recipients' inboxes use `lead`. Both must keep working forever —
// an unsubscribe link that 400s is a compliance problem, not a cosmetic one.
function leadIdFrom(req: NextRequest): string | null {
  const q = req.nextUrl.searchParams;
  return q.get("lead_id") || q.get("lead");
}

async function unsubscribe(leadId: string | null) {
  if (!leadId) {
    return page("Invalid link", "This unsubscribe link is missing its identifier.", 400);
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, status, status_before_suppression, opt_out")
    .eq("id", leadId)
    .maybeSingle();

  if (error || !lead) {
    // Don't leak whether the id exists; treat as success from the user's view.
    return page(
      "You've been unsubscribed",
      "You will no longer receive emails from us. Thank you."
    );
  }

  if (!lead.opt_out) {
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        opt_out: true,
        status: "Do Not Contact",
        // Preserve where the lead was in the pipeline before suppression, but
        // never overwrite an already-captured value.
        status_before_suppression: lead.status_before_suppression || lead.status || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);
    if (updateError) return page("Unable to update preferences", "Please contact us and we will remove you immediately.", 500);
    await logStatusChange({ leadId, from: lead.status ?? null, to: "Do Not Contact", source: "automation" });
  }

  await supabase
    .from("follow_up_tasks")
    .update({ status: "cancelled", completed_at: new Date().toISOString(), notes: "Cancelled because contact unsubscribed" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  return page(
    "You've been unsubscribed",
    "You will no longer receive emails from us. Thank you."
  );
}

// Most email clients follow the link with a GET.
export async function GET(req: NextRequest) {
  return unsubscribe(leadIdFrom(req));
}

// List-Unsubscribe-Post / one-click unsubscribers use POST.
export async function POST(req: NextRequest) {
  return unsubscribe(leadIdFrom(req));
}
