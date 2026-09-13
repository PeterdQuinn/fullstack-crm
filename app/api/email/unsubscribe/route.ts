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

/**
 * The insurance pipeline mails from the same domain, so its footer needs a
 * working opt-out too — and CAN-SPAM does not care which of our pipelines sent
 * the message. Suppression here is total: the stage moves to Do not contact and
 * opt_out is set, which every insurance query already honours.
 */
async function unsubscribeProspect(prospectId: string) {
  const { data: prospect, error } = await supabase
    .from("insurance_prospects").select("id, stage, opt_out").eq("id", prospectId).maybeSingle();
  if (error || !prospect) {
    return page("You've been unsubscribed", "You will no longer receive emails from us. Thank you.");
  }
  if (!prospect.opt_out) {
    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from("insurance_prospects").update({
      opt_out: true, stage: "Do not contact", suppression_reason: "unsubscribed from an email",
      suppressed_at: now, updated_at: now,
    }).eq("id", prospectId);
    if (updateError) {
      return page("Something went wrong", "We could not record your request. Please reply to the email with STOP and we will remove you by hand.", 500);
    }
    await supabase.from("insurance_tasks").update({ status: "cancelled", completed_at: now, notes: "Cancelled: unsubscribed" })
      .eq("prospect_id", prospectId).eq("status", "pending");
    await supabase.from("insurance_activities").insert({
      prospect_id: prospectId, kind: "suppressed", summary: "Unsubscribed from an email", actor: "recipient",
    });
  }
  return page("You've been unsubscribed", "You will no longer receive emails from us. Thank you.");
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

/** `prospect_id` is an insurance record; `lead_id`/`lead` is an HVAC lead. */
async function handle(req: NextRequest) {
  const prospectId = req.nextUrl.searchParams.get("prospect_id");
  if (prospectId) {
    if (!/^[0-9a-f-]{36}$/i.test(prospectId)) {
      return page("Invalid link", "This unsubscribe link is missing its identifier.", 400);
    }
    return unsubscribeProspect(prospectId);
  }
  return unsubscribe(leadIdFrom(req));
}

// Most email clients follow the link with a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}

// List-Unsubscribe-Post / one-click unsubscribers use POST.
export async function POST(req: NextRequest) {
  return handle(req);
}
