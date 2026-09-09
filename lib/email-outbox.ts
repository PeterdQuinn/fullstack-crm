import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { randomUUID } from "node:crypto";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const provider = new Resend(process.env.RESEND_API_KEY);

export function trackingForKey(key: string) {
  const match = /^crm-([0-9a-f-]{36})-(email-[123]|booking-link)$/.exec(key);
  return { lead_id: match?.[1] || null, message_type: match?.[2].replaceAll("-", "_") || "notification" };
}

async function finalize(id: string) {
  const { error } = await db.rpc("finalize_email_outbox", { p_id: id });
  if (error) throw new Error(`Email accepted; saved outbox will repair tracking: ${error.message}`);
}

async function deliver(item: any): Promise<{ id: string }> {
  if (item.status === "sent") {
    await finalize(item.id);
    return { id: item.provider_message_id };
  }
  if (item.lead_id) {
    const { data: lead, error } = await db.from("leads")
      .select("email,status,opt_out,bounced,complained,archived_at").eq("id", item.lead_id).single();
    if (error) throw new Error(`Cannot verify saved recipient: ${error.message}`);
    const cold = /^email_[123]$/.test(item.message_type);
    if (lead.opt_out || lead.bounced || lead.complained || lead.archived_at || lead.status === "Do Not Contact" ||
        lead.email?.toLowerCase() !== item.recipient.toLowerCase() ||
        (cold && !["Ready for Outreach", "Follow-Up Scheduled", "Email 1 Sent", "Email 2 Sent"].includes(lead.status))) {
      const { error: saveError } = await db.from("email_outbox").update({ status: "cancelled", error_message: "Recipient no longer eligible" }).eq("id", item.id);
      if (saveError) throw new Error(saveError.message);
      throw new Error("Saved email cancelled: recipient no longer eligible");
    }
  }
  const { data, error } = await db.rpc("claim_email_outbox", { p_id: item.id });
  if (error) throw new Error(`Cannot reserve saved email: ${error.message}`);
  const claimed = data?.[0];
  if (!claimed) throw new Error("Email deferred: daily cap, active send, or delivery review required");
  try {
    const result = await provider.emails.send({ from: claimed.sender, to: claimed.recipient,
      subject: claimed.subject, html: claimed.html, replyTo: claimed.reply_to }, { idempotencyKey: claimed.idempotency_key });
    if (result.error || !result.data?.id) throw new Error(result.error?.message || "Provider returned no message ID");
    const { error: saveError } = await db.from("email_outbox").update({ status: "sent",
      provider_message_id: result.data.id, accepted_at: new Date().toISOString(), error_message: null }).eq("id", claimed.id);
    if (saveError) throw new Error(`Provider accepted email; outbox confirmation failed: ${saveError.message}`);
    await finalize(claimed.id);
    return { id: result.data.id };
  } catch (err) {
    // Keep the original payload and key. Recovery reuses them inside the
    // provider deduplication window; old ambiguous attempts require review.
    const { error: saveError } = await db.from("email_outbox").update({
      error_message: err instanceof Error ? err.message : String(err),
    }).eq("id", claimed.id);
    if (saveError) console.error("Could not save outbox error:", saveError.message);
    throw err;
  }
}

export async function sendSavedEmail(email: string, subject: string, html: string, replyTo?: string,
  idempotencyKey?: string, tracking?: { bodyText?: string; source?: "owner" | "automation"; limit?: number }) {
  const key = idempotencyKey || `crm-notification-${randomUUID()}`;
  const trackingFields = trackingForKey(key);
  // Ignore duplicates rather than replacing a payload that may already have
  // reached the provider. A retry must replay exactly what was saved first.
  const { error } = await db.from("email_outbox").upsert({
    idempotency_key: key, ...trackingFields, recipient: email,
    sender: process.env.RESEND_FROM_EMAIL || "peter@fullstackservicesllc.net",
    reply_to: replyTo || "owner@fullstackservicesllc.net", subject, html,
    body_text: tracking?.bodyText || html, source: tracking?.source || "automation", send_limit: tracking?.limit || 40,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error(`Email not sent: could not save outgoing message: ${error.message}`);
  const { data: item, error: readError } = await db.from("email_outbox").select("*").eq("idempotency_key", key).single();
  if (readError) throw new Error(`Email not sent: could not read saved message: ${readError.message}`);
  return deliver(item);
}

export async function recoverEmailOutbox() {
  const { data, error } = await db.from("email_outbox").select("*")
    .is("finalized_at", null).in("status", ["pending", "sending", "sent"])
    .order("created_at").limit(10);
  if (error) throw new Error(`Cannot load email recovery queue: ${error.message}`);
  const result = { recovered: 0, deferred: 0, errors: [] as string[] };
  for (const item of data || []) {
    if (item.status === "sending" && Date.parse(item.last_attempt_at) > Date.now() - 180000) { result.deferred++; continue; }
    try { await deliver(item); result.recovered++; }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("Email deferred:") || message.startsWith("Saved email cancelled:")) result.deferred++;
      else result.errors.push(`${item.id}: ${message}`);
    }
  }
  return result;
}
