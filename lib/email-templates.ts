// Single source of truth for outbound outreach email rendering (automation
// emails 1–3 + the shared footer). Used by BOTH the cron send phase
// (lib/automation.ts) and the manual copy-paste Email Queue
// (app/api/email/queue) so the two never drift.
//
// The footer carries the physical mailing address (CAN-SPAM) plus a real
// one-click unsubscribe URL. /api/email/unsubscribe is exempted from the CRM's
// Basic Auth precisely so a recipient can click it from their inbox; it was
// fully built but nothing ever linked to it, leaving "Reply STOP" (a manual
// process) as the only opt-out path. The link is now emitted whenever we know
// the lead's id, and the STOP line remains as the fallback when we don't.

export const COMPANY_NAME = "Full Stack Services LLC";

// Visible signature line. Deliberately a service-area tagline, NOT a street
// address — the legally required postal address lives in the footer below.
export const COMPANY_LOCATION_TAGLINE =
  "Serving the greater Phoenix metro area and beyond.";

// CAN-SPAM §7704(a)(5) requires a real physical postal address in every
// commercial message. A PO box is pending, so this is intentionally a
// placeholder and NOT a guess — an invented address is itself a violation.
// `mailingAddressConfigured()` gates every lead-facing send until it is set.
export const MAILING_ADDRESS_PLACEHOLDER = "[MAILING ADDRESS]";
export const COMPANY_MAILING_ADDRESS =
  process.env.COMPANY_MAILING_ADDRESS?.trim() || MAILING_ADDRESS_PLACEHOLDER;

// A street address ("535 E Southern Ave") or a PO box ("PO Box 1234"). Checking
// only for the placeholder was too weak: "Full Stack Services LLC, Mesa, AZ
// 85201" — a company name and a city with no deliverable address — passed
// happily, and a ZIP code alone does not satisfy CAN-SPAM's physical-address
// requirement. This demands a street number or a PO box.
const DELIVERABLE_ADDRESS = /(\bp\.?\s*o\.?\s*box\s*\d+)|(\b\d+\s+[A-Za-z])/i;

/** False while the postal address is missing, placeholder, or undeliverable. */
export function mailingAddressConfigured(): boolean {
  const a = COMPANY_MAILING_ADDRESS;
  return a !== MAILING_ADDRESS_PLACEHOLDER && DELIVERABLE_ADDRESS.test(a);
}

/** Reason string for a blocked send, or null when sending is permitted. */
export function sendBlockedReason(): string | null {
  if (mailingAddressConfigured()) return null;
  return COMPANY_MAILING_ADDRESS === MAILING_ADDRESS_PLACEHOLDER
    ? `CAN-SPAM: COMPANY_MAILING_ADDRESS is still ${MAILING_ADDRESS_PLACEHOLDER}. Set it before sending.`
    : `CAN-SPAM: COMPANY_MAILING_ADDRESS ("${COMPANY_MAILING_ADDRESS}") has no street address or PO box. A city and ZIP alone are not a valid physical postal address.`;
}

export const UNSUBSCRIBE_LINE = "Reply STOP to unsubscribe from future emails.";

/**
 * Absolute unsubscribe URL for a lead, or null when the id or the app URL is
 * unknown (a relative link is useless inside an email client).
 *
 * The query param is `lead_id`; the route also accepts the legacy `lead` name.
 */
// Production alias, used when the env var is unset or still holds the template
// placeholder. CAN-SPAM requires a working opt-out in EVERY message, so this
// must never degrade to the manual "Reply STOP" line just because an env var
// drifted — that turns a compliance guarantee into a config accident.
const FALLBACK_APP_URL = "https://fullstack-crm-nine.vercel.app";

function appBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  const usable = raw.startsWith("https://") && !/your-deployed-domain/i.test(raw);
  return usable ? raw : FALLBACK_APP_URL;
}

export function unsubscribeUrl(leadId?: string | null): string | null {
  if (!leadId) return null;
  return `${appBaseUrl()}/api/email/unsubscribe?lead_id=${encodeURIComponent(leadId)}`;
}

// HTML footer appended to every outbound email body.
export function footerHtml(leadId?: string | null): string {
  const url = unsubscribeUrl(leadId);
  const optOut = url
    ? `<a href="${url}" style="color:#999;">Unsubscribe</a> from future emails.`
    : UNSUBSCRIBE_LINE;
  return `<hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px;">
<p style="color:#999;font-size:12px;line-height:1.5;margin:0;">
${COMPANY_NAME}<br>${COMPANY_MAILING_ADDRESS}<br>${optOut}
</p>`;
}

// Plain-text footer for the copy-paste view.
export function footerText(leadId?: string | null): string {
  const url = unsubscribeUrl(leadId);
  const optOut = url ? `Unsubscribe: ${url}` : UNSUBSCRIBE_LINE;
  return `${COMPANY_NAME}\n${COMPANY_MAILING_ADDRESS}\n${optOut}`;
}

export interface RenderedOutreachEmail {
  emailNum: number; // 1..3 (which touch in the sequence)
  subject: string;
  html: string; // full HTML email (used if/when actually sent)
  messageText: string; // editable message without the protected footer
  bodyText: string; // plain-text body incl. footer (for copy-paste)
  copyText: string; // "Subject: …\n\n<bodyText>" — the full copy-paste blob
}

/** CAN-SPAM requires the recipient's own name never be injected as markup. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SUBJECTS: Record<number, (company: string) => string> = {
  1: (company) => `Does ${company} own the software it depends on?`,
  2: (company) => `Stop renting the software that runs ${company}`,
  3: (company) => `Should ${company} own its business software?`,
};

const PETER_SIGNATURE = [
  "Peter Quinn",
  "Owner, Full Stack Services LLC",
  "fullstackservicesllc.net",
];

function messageParagraphs(emailNum: number, ownerName: string, company: string): string[] {
  if (emailNum === 1) {
    return [
      `Hi ${ownerName},`,
      `If ${company} stopped paying its software subscriptions tomorrow, how much of the system running the business would it still own?`,
      `I'm Peter Quinn, owner of Full Stack Services LLC. I help businesses replace rented software with custom systems built around how they actually work. The business owns the system instead of paying forever for access to it.`,
      `If owning your business software is worth exploring, let me know a good time for a short call.`,
      ...PETER_SIGNATURE,
    ];
  }

  if (emailNum === 2) {
    return [
      `Hi ${ownerName},`,
      `The software that runs scheduling, dispatch, invoicing, and customer management should be a business asset, not a collection of bills that never ends.`,
      `I help businesses build one system around their operation so they can own the tool they depend on. If you want to see what that could look like for ${company}, let me know a good time for a short call.`,
      ...PETER_SIGNATURE,
    ];
  }

  return [
    `Hi ${ownerName},`,
    `One last question. Does ${company} want to keep renting its business software, or would owning a system built for the way you work be worth a conversation?`,
    `If ownership is worth exploring, I can walk you through the idea in one short call. If not, no problem.`,
    ...PETER_SIGNATURE,
  ];
}

// Build the exact approved email for a lead's position in the sequence. The
// manual workspace and automated followup processor both use this renderer so
// the preview always matches the sent message.
export function renderOutreachEmail(opts: {
  businessName: string;
  emailSentCount: number;
  /** Lead id — required for the footer's one-click unsubscribe link. */
  leadId?: string | null;
  /** Lead's owner_name. Blank/missing renders the "there" fallback. */
  ownerName?: string | null;
}): RenderedOutreachEmail {
  const company = opts.businessName;
  const emailNum = Math.min((opts.emailSentCount || 0) + 1, 3);
  const ownerName = (opts.ownerName || "").trim() || "there";

  const subject = SUBJECTS[emailNum](company);
  const paragraphs = messageParagraphs(emailNum, ownerName, company);
  const html =
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color:#222; font-size:15px; line-height:1.6;">` +
    paragraphs.map((paragraph) => `<p style="margin:0 0 16px;">${esc(paragraph)}</p>`).join("") +
    footerHtml(opts.leadId) +
    `</div>`;
  const bodyText = `${paragraphs.join("\n\n")}\n\n${footerText(opts.leadId)}`;
  const copyText = `Subject: ${subject}\n\n${bodyText}`;

  return { emailNum, subject, html, messageText: paragraphs.join("\n\n"), bodyText, copyText };
}

export function renderEditedOutreachEmail(opts: {
  emailNum: number;
  subject: string;
  messageText: string;
  leadId: string;
}): RenderedOutreachEmail {
  const subject = opts.subject.replace(/[\r\n]+/g, " ").trim();
  const messageText = opts.messageText.trim();
  const paragraphs = messageText.split(/\n\s*\n/).filter(Boolean);
  const html =
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color:#222; font-size:15px; line-height:1.6;">` +
    paragraphs.map((paragraph) => `<p style="margin:0 0 16px;">${esc(paragraph).replace(/\n/g, "<br>")}</p>`).join("") +
    footerHtml(opts.leadId) +
    `</div>`;
  const bodyText = `${messageText}\n\n${footerText(opts.leadId)}`;
  return {
    emailNum: opts.emailNum,
    subject,
    html,
    messageText,
    bodyText,
    copyText: `Subject: ${subject}\n\n${bodyText}`,
  };
}
