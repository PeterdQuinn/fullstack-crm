import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const event = await req.json();
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
