import { withAutomationRun } from "@/lib/automation-runs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { classifyReply } from "@/lib/grok";
import { actOnReplyClassification, cancelPendingColdEmailTasks } from "@/lib/reply-actions";
import { bucketForCategory } from "@/lib/reply-policy";
import { logStatusChange } from "@/lib/audit";
import { fetchRecentInbox, markRead, replyText, graphMissingReason, type GraphMessage } from "@/lib/graph-inbox";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Pulls prospect replies out of the owner's Outlook inbox and into the CRM.
//
// Before this existed, /api/ai/classify-reply was only ever called from a button
// in the browser, so the "autonomous" reply chain could not start on its own:
// someone had to read the reply in Outlook, copy it into /crm/replies and click.
// This closes that gap. Replies still arrive in Outlook exactly as before — this
// mirrors a copy in and lets the automation act on it.
//
// AUTOPILOT IS OFF BY DEFAULT. Without REPLY_AUTOPILOT=true the route records
// the reply and marks the lead "Replied", but does NOT send the Calendly link or
// set Do Not Contact. Acting on a misclassified reply means mailing a real
// prospect the wrong thing, so the acting half stays opt-in until the
// classifier has been watched against genuine replies.
const autopilot = () => process.env.REPLY_AUTOPILOT === "true";

// Free providers: a shared domain says nothing about identity. Matching on
// gmail.com paired a reply from peterdquinnsr@gmail.com to a lead whose address
// was americancomfortservices@gmail.com — same domain, unrelated people.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "zoho.com", "comcast.net", "verizon.net",
  "sbcglobal.net", "att.net", "cox.net", "charter.net", "bellsouth.net",
]);

/**
 * PostgREST `ilike` treats % and _ as wildcards, and the values below come
 * straight off an inbound message. A sender whose local part contains % would
 * match leads it has nothing to do with — and with autopilot on, the CRM then
 * acts: a Calendly link to someone who never wrote, or a lead marked Do Not
 * Contact by a stranger.
 */
function literal(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/** "Re: Question about Acme's software" -> "question about acme's software" */
function normalizeSubject(subject: string | null | undefined): string {
  return (subject || "").replace(/^\s*(?:re|fw|fwd)\s*:\s*/i, "").trim().toLowerCase();
}

// 57% of the list is a role inbox, so the reply that matters most is the one
// least likely to come back from the address we mailed: we write to
// info@acme.com and the owner answers from mike@acme.com. Exact-address
// matching alone files that as "no lead matches" and the reply is lost.
async function findLeadForReply(address: string, subject: string | null | undefined) {
  const { data: exact } = await supabase
    .from("leads").select("id, business_name, status, email")
    .ilike("email", literal(address)).is("archived_at", null).limit(1);
  if (exact?.[0]) return { lead: exact[0], matchedBy: "address" as const };

  // Tier 2: the reply quotes a subject we actually sent. Strongest non-address
  // signal there is — it can only exist if we mailed this thread.
  const threadSubject = normalizeSubject(subject);
  if (threadSubject) {
    const { data: sent } = await supabase
      .from("outreach_log").select("lead_id, subject")
      .eq("direction", "outbound").eq("channel", "email")
      .ilike("subject", literal(threadSubject)).limit(2);
    // Only trust it when exactly one lead was sent that subject; the templates
    // embed the company name, so a collision means we cannot tell them apart.
    const leadIds = [...new Set((sent || []).map((r: any) => r.lead_id))];
    if (leadIds.length === 1) {
      const { data: byThread } = await supabase
        .from("leads").select("id, business_name, status, email")
        .eq("id", leadIds[0]).is("archived_at", null).limit(1);
      if (byThread?.[0]) return { lead: byThread[0], matchedBy: "thread" as const };
    }
  }

  // Tier 3: same company domain, and only for a domain the company owns.
  const domain = address.split("@")[1]?.toLowerCase() || "";
  if (domain && !PUBLIC_MAILBOX_DOMAINS.has(domain)) {
    const { data: byDomain } = await supabase
      .from("leads").select("id, business_name, status, email")
      .ilike("email", `%@${domain}`).is("archived_at", null).limit(2);
    if (byDomain?.length === 1) return { lead: byDomain[0], matchedBy: "domain" as const };
  }

  return null;
}

/**
 * A reply to the insurance pipeline.
 *
 * Matching is exact-address only. The lead matcher can fall back to a thread
 * subject or a company domain because a lead is a business; an insurance
 * prospect is a person, and guessing which person replied is the one mistake
 * that cannot be walked back.
 *
 * The only automated action is suppression. A "not interested" reply stops
 * every future touch immediately, because that is what the person asked for and
 * acting fast on it can only help them. Everything else stops the sequence and
 * waits for a human — booking a meeting or quoting a policy off a classifier's
 * guess is not a mistake worth risking.
 */
async function handleInsuranceReply(msg: GraphMessage, from: string) {
  const { data: matches } = await supabase
    .from("insurance_prospects")
    .select("id, name, stage, email, replied_at")
    .ilike("email", literal(from))
    .limit(2);
  if (matches?.length !== 1) return null;
  const person = matches[0];

  const text = replyText(msg);
  const classification = await classifyReply(text).catch(() => null);
  const category = classification?.category ?? "Unclear";
  const bucket = bucketForCategory(category);
  const now = new Date().toISOString();

  const alreadyRecorded = Boolean(person.replied_at);
  const closing = bucket === "not_interested" && autopilot();

  const { error: updateError } = await supabase
    .from("insurance_prospects")
    .update({
      replied_at: person.replied_at || msg.receivedDateTime || now,
      ...(closing
        ? { stage: "Do not contact", opt_out: true, suppression_reason: `replied ${category}`, suppressed_at: now }
        : person.stage === "Contacted" || person.stage === "Qualified"
          ? { stage: "Replied" }
          : {}),
      updated_at: now,
    })
    .eq("id", person.id);
  if (updateError) throw new Error(`Failed to record insurance reply: ${updateError.message}`);

  // A reply always ends the sequence, whatever it said.
  const { error: taskError } = await supabase
    .from("insurance_tasks")
    .update({ status: "cancelled", completed_at: now, notes: "Cancelled automatically: the prospect replied" })
    .eq("prospect_id", person.id)
    .eq("status", "pending")
    .like("task_type", "send_touch_%");
  if (taskError) throw new Error(`Failed to stop the insurance sequence: ${taskError.message}`);

  if (!alreadyRecorded) {
    await supabase.from("insurance_activities").insert({
      prospect_id: person.id,
      kind: "reply",
      summary: `Replied — classified ${category}`,
      detail: { category, bucket, body: text.slice(0, 4000), subject: msg.subject },
      actor: "prospect",
    });
    if (!closing) {
      await supabase.from("insurance_tasks").insert({
        prospect_id: person.id,
        task_type: "read_reply",
        due_at: now,
        status: "pending",
        notes: `Reply classified ${category} — read it and decide the next step`,
      });
    }
  }

  return { insurance: person.name, matchedBy: "address" as const, category, acted: closing };
}

async function storedReply(messageId: string): Promise<{ id: string; status: string | null } | null> {
  const { data } = await supabase
    .from("outreach_log")
    .select("id, status")
    .eq("provider_message_id", messageId)
    .limit(1);
  return data?.[0] ?? null;
}

async function markReplyProcessed(messageId: string): Promise<void> {
  const { data, error } = await supabase
    .from("outreach_log")
    .update({ status: "processed" })
    .eq("provider_message_id", messageId)
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message || "Reply processing marker changed no rows");
}

async function handle(msg: GraphMessage) {
  const from = (msg.from?.emailAddress?.address || "").trim().toLowerCase();
  if (!from) return { skipped: "no sender address" };

  const match = await findLeadForReply(from, msg.subject);
  if (!match) {
    // The insurance pipeline mails from the same mailbox, so a reply with no
    // lead behind it may still belong to someone we wrote to.
    const insurance = await handleInsuranceReply(msg, from);
    if (insurance) return insurance;
    return { skipped: `no lead matches ${from}` };
  }
  const { lead, matchedBy } = match;

  // Graph ids are stable, so retries must not insert the inbound log twice.
  // Do not return early when the log already exists: the previous attempt may
  // have crashed after storing the reply but before cancelling follow-ups,
  // updating the lead, or marking the Graph message read. Re-running the
  // remaining idempotent actions lets that partial attempt finish safely.
  const stored = await storedReply(msg.id);
  if (stored?.status === "processed") return { skipped: "already processed", retryMarkRead: !msg.isRead };

  const text = replyText(msg);

  if (!stored) {
    const { error: replyLogError } = await supabase.from("outreach_log").insert({
      lead_id: lead.id,
      channel: "email",
      direction: "inbound",
      message_type: "reply",
      subject: msg.subject,
      message_body: text,
      status: "received",
      provider: "microsoft-graph",
      provider_message_id: msg.id,
      replied_at: msg.receivedDateTime,
    });
    if (replyLogError) throw new Error(`Failed to store inbound reply: ${replyLogError.message}`);
  }

  // Recording a reply always stops queued cold touches, even while classifier
  // autopilot is disabled and a human is responsible for the next action.
  await cancelPendingColdEmailTasks(lead.id);

  const classification = await classifyReply(text).catch(() => null);
  const category = classification?.category ?? "Unclear";

  if (!autopilot()) {
    // Record only. Surfaces in /crm/replies for a human to action.
    if (lead.status !== "Replied") {
      const { error: updateError } = await supabase
        .from("leads")
        .update({ status: "Replied", updated_at: new Date().toISOString() })
        .eq("id", lead.id);
      if (updateError) throw new Error(`Failed to mark lead Replied: ${updateError.message}`);
      await logStatusChange({
        leadId: lead.id,
        from: lead.status ?? null,
        to: "Replied",
        source: "automation",
        reason: `inbound reply classified ${category} (autopilot off, matched by ${matchedBy})`,
      });
    }
    await markReplyProcessed(msg.id);
    return { lead: lead.business_name, matchedBy, category, acted: false, resumed: Boolean(stored) };
  }

  const action = await actOnReplyClassification(lead.id, category);
  await markReplyProcessed(msg.id);
  return { lead: lead.business_name, matchedBy, category, acted: true, action, resumed: Boolean(stored) };
}

async function handleGET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reply polling is part of the required automation. Missing credentials must
  // fail visibly; a green cron that never reads replies is a false positive.
  const missing = graphMissingReason();
  if (missing) {
    console.error(`poll-replies unavailable: ${missing}`);
    return NextResponse.json(
      { success: false, error: missing, scanned: 0, matched: 0 },
      { status: 503 }
    );
  }

  try {
    const messages = await fetchRecentInbox(50, 7);
    const results: any[] = [];

    for (const msg of messages) {
      try {
        const r = await handle(msg);
        results.push(r);
        // Preserve the owner's read state for unrelated/unmatched mail. A
        // processed CRM reply is marked read only when it was unread; if that
        // PATCH failed previously, retry it without repeating CRM actions.
        if ((!('skipped' in r) && !msg.isRead) || ('retryMarkRead' in r && r.retryMarkRead)) {
          await markRead(msg.id);
        }
      } catch (e) {
        results.push({ messageId: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const errors = results.filter((r) => r.error);
    const payload = {
      success: errors.length === 0,
      autopilot: autopilot(),
      scanned: messages.length,
      matched: results.filter((r) => r.lead).length,
      matchedInsurance: results.filter((r) => r.insurance).length,
      skipped: results.filter((r) => r.skipped).length,
      errors: errors.length,
      results,
    };
    return NextResponse.json(payload, { status: errors.length === 0 ? 200 : 500 });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

export async function GET(req: NextRequest) {
  return withAutomationRun("poll-replies", req, () => handleGET(req));
}
