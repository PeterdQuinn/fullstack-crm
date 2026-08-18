import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { classifyReply } from "@/lib/grok";
import { actOnReplyClassification, cancelPendingColdEmailTasks } from "@/lib/reply-actions";
import { logStatusChange } from "@/lib/audit";
import { fetchUnread, markRead, replyText, graphMissingReason, type GraphMessage } from "@/lib/graph-inbox";

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

async function findLeadByEmail(address: string) {
  const { data } = await supabase
    .from("leads")
    .select("id, business_name, status, email")
    .ilike("email", address)
    .is("archived_at", null)
    .limit(1);
  return data?.[0] ?? null;
}

async function alreadyStored(messageId: string): Promise<boolean> {
  const { data } = await supabase
    .from("outreach_log")
    .select("id")
    .eq("provider_message_id", messageId)
    .limit(1);
  return Boolean(data?.length);
}

async function handle(msg: GraphMessage) {
  const from = (msg.from?.emailAddress?.address || "").trim().toLowerCase();
  if (!from) return { skipped: "no sender address" };

  const lead = await findLeadByEmail(from);
  if (!lead) return { skipped: `no lead matches ${from}` };

  // Idempotent: Graph ids are stable, so a retry after a partial failure will
  // not double-log or re-fire the automation.
  if (await alreadyStored(msg.id)) return { skipped: "already stored" };

  const text = replyText(msg);

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
        reason: `inbound reply classified ${category} (autopilot off)`,
      });
    }
    return { lead: lead.business_name, category, acted: false };
  }

  const action = await actOnReplyClassification(lead.id, category);
  return { lead: lead.business_name, category, acted: true, action };
}

export async function GET(req: NextRequest) {
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
    const unread = await fetchUnread(25);
    const results: any[] = [];

    for (const msg of unread) {
      try {
        const r = await handle(msg);
        results.push(r);
        // Only mark read once the CRM has it — a crash mid-batch leaves the
        // message unread so the next run retries it instead of losing it.
        if (!("skipped" in r)) await markRead(msg.id);
      } catch (e) {
        results.push({ messageId: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const errors = results.filter((r) => r.error);
    const payload = {
      success: errors.length === 0,
      autopilot: autopilot(),
      scanned: unread.length,
      matched: results.filter((r) => r.lead).length,
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
