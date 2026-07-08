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
    await supabase
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
    await logStatusChange({ leadId, from: lead.status ?? null, to: "Do Not Contact", source: "automation" });
  }

  return page(
    "You've been unsubscribed",
    "You will no longer receive emails from us. Thank you."
  );
}

// Most email clients follow the link with a GET.
export async function GET(req: NextRequest) {
  return unsubscribe(req.nextUrl.searchParams.get("lead"));
}

// List-Unsubscribe-Post / one-click unsubscribers use POST.
export async function POST(req: NextRequest) {
  return unsubscribe(req.nextUrl.searchParams.get("lead"));
}
