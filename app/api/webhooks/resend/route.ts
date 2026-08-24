import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Webhook } from "svix";
import { logStatusChange } from "@/lib/audit";
import { cancelPendingColdEmailTasks } from "@/lib/reply-actions";

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

    const { data: log, error: logLookupError } = await supabase
      .from("outreach_log")
      .select("id, lead_id")
      .eq("provider_message_id", messageId)
      .single();

    if (logLookupError) {
      return NextResponse.json(
        { received: false, error: `Outreach log lookup failed: ${logLookupError.message}` },
        { status: logLookupError.code === "PGRST116" ? 404 : 500 }
      );
    }

    if (!log) {
      return NextResponse.json({ received: false, error: "Email is not present in outreach_log" }, { status: 404 });
    }

    async function requireDb(operation: PromiseLike<any>, label: string) {
      const result = await operation;
      if (result.error) throw new Error(`${label}: ${result.error.message}`);
      return result.data;
    }

    // For suppression events (bounce/complaint) we snapshot the lead's current
    // pipeline status before overwriting it, so the Suppressed view can show
    // where the lead was. Only captured the first time (not already suppressed).
    async function captureStatusBeforeSuppression(): Promise<string | undefined> {
      const { data: leadRow, error: leadError } = await supabase
        .from("leads")
        .select("status, status_before_suppression, opt_out, bounced, complained")
        .eq("id", log!.lead_id)
        .single();
      if (leadError) throw new Error(`Lead suppression lookup failed: ${leadError.message}`);
      if (!leadRow) return undefined;
      const alreadySuppressed = leadRow.opt_out || leadRow.bounced || leadRow.complained;
      if (leadRow.status_before_suppression || alreadySuppressed) return undefined;
      return leadRow.status || undefined;
    }

    switch (event.type) {
      case "email.delivered":
        await requireDb(supabase
          .from("outreach_log")
          .update({ delivered_at: new Date().toISOString() })
          .eq("id", log.id), "Delivery tracking update failed");
        break;

      case "email.opened": {
        await requireDb(supabase
          .from("outreach_log")
          .update({ opened_at: new Date().toISOString() })
          .eq("id", log.id), "Open tracking update failed");

        const { data: lead, error: leadError } = await supabase
          .from("leads").select("status").eq("id", log.lead_id).single();
        if (leadError) throw new Error(`Opened lead lookup failed: ${leadError.message}`);
        const callableStatuses = new Set(["Ready for Outreach", "Email 1 Sent", "Email 2 Sent", "Email 3 Sent"]);
        if (lead && callableStatuses.has(lead.status)) {
          await requireDb(supabase.from("leads")
            .update({ status: "Call Needed", updated_at: new Date().toISOString() })
            .eq("id", log.lead_id), "Opened lead prioritization failed");
          await logStatusChange({
            leadId: log.lead_id,
            from: lead.status,
            to: "Call Needed",
            source: "automation",
            reason: "prospect opened outreach email",
          });
        }
        break;
      }

      case "email.clicked":
        await requireDb(supabase
          .from("outreach_log")
          .update({ clicked_at: new Date().toISOString() })
          .eq("id", log.id), "Click tracking update failed");
        break;

      case "email.bounced": {
        const before = await captureStatusBeforeSuppression();
        await requireDb(supabase
          .from("outreach_log")
          .update({
            bounced_at: new Date().toISOString(),
            status: "bounced",
          })
          .eq("id", log.id), "Bounce log update failed");

        await requireDb(supabase
          .from("leads")
          .update({
            bounced: true,
            status: "Bad Email",
            ...(before ? { status_before_suppression: before } : {}),
          })
          .eq("id", log.lead_id), "Bounced lead suppression failed");
        await cancelPendingColdEmailTasks(log.lead_id);
        await logStatusChange({ leadId: log.lead_id, from: before ?? null, to: "Bad Email", source: "automation" });
        break;
      }

      case "email.complained": {
        const before = await captureStatusBeforeSuppression();
        await requireDb(supabase
          .from("outreach_log")
          .update({
            status: "complained",
          })
          .eq("id", log.id), "Complaint log update failed");

        await requireDb(supabase
          .from("leads")
          .update({
            complained: true,
            opt_out: true,
            status: "Do Not Contact",
            ...(before ? { status_before_suppression: before } : {}),
          })
          .eq("id", log.lead_id), "Complained lead suppression failed");
        await cancelPendingColdEmailTasks(log.lead_id);
        await logStatusChange({ leadId: log.lead_id, from: before ?? null, to: "Do Not Contact", source: "automation" });
        break;
      }

      // Resend accepted the API call but never delivered the message. The common
      // cause is the address sitting on the account's suppression list from an
      // earlier bounce or complaint — Resend silently refuses rather than
      // bouncing again.
      //
      // Without this case a suppressed send is indistinguishable from a
      // successful one: `delivered_at` stays null, nothing reads that, the lead
      // keeps status "Email 1 Sent", and the scheduler mails the same dead
      // address again three days later. Observed on info@azcpg.com, which was
      // suppressed by Resend and still had a follow-up queued for 2026-08-27.
      case "email.failed": {
        const payload = event.data as Record<string, unknown> | undefined;
        const reason = String(payload?.reason ?? payload?.error ?? payload?.message ?? "").toLowerCase();

        // Same discipline as lib/email-validation's transient DNS handling: only
        // an authoritative failure may be terminal. "Bad Email" is a one-way
        // door — nothing retries it — so a rate limit or provider blip must
        // never send a live prospect through it.
        const terminal =
          /suppress|invalid|does not exist|no such|unknown recipient|blocked|rejected|not found/.test(reason);

        await requireDb(supabase
          .from("outreach_log")
          .update({ status: terminal ? "failed" : "failed_retryable" })
          .eq("id", log.id), "Failed-send log update failed");

        if (!terminal) {
          // Leave the lead and its queued tasks untouched: the address may be
          // perfectly good and the next touch can still land.
          console.warn(`Resend reported a retryable failure for lead ${log.lead_id}: ${reason || "no reason given"}`);
          break;
        }

        const before = await captureStatusBeforeSuppression();
        await requireDb(supabase
          .from("leads")
          .update({
            // Reuses the existing `bounced` flag deliberately rather than adding
            // a parallel suppression column: every eligibility query in the app
            // already excludes on it, and a suppressed address IS undeliverable.
            bounced: true,
            status: "Bad Email",
            ...(before ? { status_before_suppression: before } : {}),
          })
          .eq("id", log.lead_id), "Failed-send suppression failed");
        await cancelPendingColdEmailTasks(log.lead_id);
        await logStatusChange({
          leadId: log.lead_id,
          from: before ?? null,
          to: "Bad Email",
          source: "automation",
          reason: `Resend did not deliver: ${reason || "suppressed"}`,
        });
        break;
      }

      default:
        return NextResponse.json({ received: true, handled: false, type: event.type });
    }

    return NextResponse.json({ received: true, handled: true, type: event.type });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
