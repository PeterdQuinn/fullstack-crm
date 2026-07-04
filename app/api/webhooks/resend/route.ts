import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "svix";

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

      case "email.bounced":
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
          })
          .eq("id", log.lead_id);
        break;

      case "email.complained":
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
          })
          .eq("id", log.lead_id);
        break;

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
