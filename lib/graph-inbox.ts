// Microsoft Graph reader for the owner's Outlook mailbox.
//
// WHY GRAPH AND NOT AN INBOUND WEBHOOK: the domain's MX points at Microsoft 365
// (fullstackservicesllc-net.mail.protection.outlook.com), and outbound mail sets
// Reply-To: owner@fullstackservicesllc.net — so prospect replies land in a real
// Outlook inbox, not in Resend. Resend can only deliver inbound mail for a
// domain whose MX points at Resend. Polling Graph keeps replies exactly where
// the owner already reads them and mirrors a copy into the CRM, rather than
// diverting the mailbox to a subdomain.
//
// Auth is app-only (client credentials), so no user sits in the loop and the
// cron can run unattended. The app registration needs Mail.Read and
// Mail.ReadWrite application permissions with admin consent.

const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphMessage = {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  isRead: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { contentType?: string; content?: string };
  conversationId?: string;
};

export function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_MAILBOX
  );
}

/** Missing-config reason, or null when Graph can be used. */
export function graphMissingReason(): string | null {
  const missing = (["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_MAILBOX"] as const).filter(
    (k) => !process.env[k]
  );
  return missing.length ? `Microsoft Graph not configured — missing ${missing.join(", ")}` : null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function graphToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Graph token failed (${res.status}): ${json.error_description || json.error || "unknown"}`);
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Recent inbox messages, newest first, regardless of read state.
 *
 * Outlook read state cannot be the processing marker: the owner may read a
 * reply before the daily CRM poll. `outreach_log.provider_message_id` plus its
 * received/processed status is the durable CRM-side marker instead.
 */
export async function fetchRecentInbox(limit = 50, days = 7): Promise<GraphMessage[]> {
  const token = await graphToken();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    "$filter": `receivedDateTime ge ${since}`,
    "$top": String(limit),
    "$orderby": "receivedDateTime desc",
    "$select": "id,subject,bodyPreview,receivedDateTime,isRead,from,body,conversationId",
  });
  const url = `${GRAPH}/users/${encodeURIComponent(process.env.MS_MAILBOX!)}/mailFolders/inbox/messages?${params}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph fetch failed (${res.status}): ${json.error?.message || "unknown"}`);
  return json.value ?? [];
}

export async function markRead(messageId: string): Promise<void> {
  const token = await graphToken();
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(process.env.MS_MAILBOX!)}/messages/${messageId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isRead: true }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(`Graph mark-read failed (${res.status}): ${json.error?.message || "unknown"}`);
  }
}

/**
 * Plain text of a reply, with quoted history removed.
 *
 * The classifier reads far better without the original email quoted underneath;
 * left in, every reply contains our own pitch and skews the categorisation.
 */
export function replyText(m: GraphMessage): string {
  const raw = m.body?.contentType === "html" ? stripHtml(m.body?.content || "") : m.body?.content || m.bodyPreview || "";
  return stripQuotedHistory(raw).trim().slice(0, 4000);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function stripQuotedHistory(text: string): string {
  const markers = [
    /^\s*On .+ wrote:\s*$/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+$/im,
    /^\s*Sent from my /im,
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}
