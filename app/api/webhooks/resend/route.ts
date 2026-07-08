import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "svix";
import { logStatusChange } from "@/lib/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  // Verify the Svix signature Resend attaches to every webhook delivery
  // before trusting any of the payload.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET not configured" },
      { status: 500 }
    );
  }

  const payload = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") || "",
    "svix-timestamp": req.headers.get("svix-timestamp") || "",
    "svix-signature": req.headers.get("svix-signature") || "",
  };

  let event: any;
  try {
    event = new Webhook(webhookSecret).verify(payload, svixHeaders);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const messageId = event.data?.email_id;

    if (!messageId) {
      return NextResponse.json(
        { error: "No email_id in event" },
        { status: 400 }
      );
    }

    const { data: log } = await supabase
      .from("outreach_log")
      .select("id, lead_id")
      .eq("provider_message_id", messageId)
      .single();

    if (!log) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // For suppression events (bounce/complaint) we snapshot the lead's current
    // pipeline status before overwriting it, so the Suppressed view can show
    // where the lead was. Only captured the first time (not already suppressed).
    async function captureStatusBeforeSuppression(): Promise<string | undefined> {
      const { data: leadRow } = await supabase
        .from("leads")
        .select("status, status_before_suppression, opt_out, bounced, complained")
        .eq("id", log!.lead_id)
        .single();
      if (!leadRow) return undefined;
      const alreadySuppressed = leadRow.opt_out || leadRow.bounced || leadRow.complained;
      if (leadRow.status_before_suppression || alreadySuppressed) return undefined;
      return leadRow.status || undefined;
    }

    switch (event.type) {
      case "email.delivered":
        await supabase
          .from("outreach_log")
          .update({ delivered_at: new Date().toISOString() })
          .eq("id", log.id);
        break;

      case "email.opened":
        await supabase
          .from("outreach_log")
          .update({ opened_at: new Date().toISOString() })
          .eq("id", log.id);
        break;

      case "email.clicked":
        await supabase
          .from("outreach_log")
          .update({ clicked_at: new Date().toISOString() })
          .eq("id", log.id);
        break;

      case "email.bounced": {
        const before = await captureStatusBeforeSuppression();
        await supabase
          .from("outreach_log")
          .update({
            bounced_at: new Date().toISOString(),
            status: "bounced",
          })
          .eq("id", log.id);

        await supabase
          .from("leads")
          .update({
            bounced: true,
            status: "Bad Email",
            ...(before ? { status_before_suppression: before } : {}),
          })
          .eq("id", log.lead_id);
        await logStatusChange({ leadId: log.lead_id, from: before ?? null, to: "Bad Email", source: "automation" });
        break;
      }

      case "email.complained": {
        const before = await captureStatusBeforeSuppression();
        await supabase
          .from("outreach_log")
          .update({
            status: "complained",
          })
          .eq("id", log.id);

        await supabase
          .from("leads")
          .update({
            complained: true,
            opt_out: true,
            status: "Do Not Contact",
            ...(before ? { status_before_suppression: before } : {}),
          })
          .eq("id", log.lead_id);
        await logStatusChange({ leadId: log.lead_id, from: before ?? null, to: "Do Not Contact", source: "automation" });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
