import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { classifyReply } from "@/lib/grok";
import { actOnReplyClassification } from "@/lib/reply-actions";
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

  await supabase.from("outreach_log").insert({
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

  const classification = await classifyReply(text).catch(() => null);
  const category = classification?.category ?? "Unclear";

  if (!autopilot()) {
    // Record only. Surfaces in /crm/replies for a human to action.
    if (lead.status !== "Replied") {
      await supabase
        .from("leads")
        .update({ status: "Replied", updated_at: new Date().toISOString() })
        .eq("id", lead.id);
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

  const action = await actOnReplyClassification(lead.id, category).catch((e) => ({ error: String(e) }) as any);
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

  // Not configured is a SKIP, not a failure. This route is scheduled every 30
  // minutes; returning a non-200 would make the workflow fail — and mail a
  // failure notice — 48 times a day purely because an optional integration is
  // not set up yet. The reason is still reported in the body and in the logs.
  const missing = graphMissingReason();
  if (missing) {
    console.warn(`poll-replies skipped: ${missing}`);
    return NextResponse.json({ success: true, skipped: missing, scanned: 0, matched: 0 });
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

    return NextResponse.json({
      success: true,
      autopilot: autopilot(),
      scanned: unread.length,
      matched: results.filter((r) => r.lead).length,
      skipped: results.filter((r) => r.skipped).length,
      results,
    });
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
