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

/** False while the postal address is still the placeholder. Blocks sends. */
export function mailingAddressConfigured(): boolean {
  return COMPANY_MAILING_ADDRESS !== MAILING_ADDRESS_PLACEHOLDER;
}

/** Reason string for a blocked send, or null when sending is permitted. */
export function sendBlockedReason(): string | null {
  return mailingAddressConfigured()
    ? null
    : `CAN-SPAM: COMPANY_MAILING_ADDRESS is still ${MAILING_ADDRESS_PLACEHOLDER}. Set it before sending.`;
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
  bodyText: string; // plain-text body incl. footer (for copy-paste)
  copyText: string; // "Subject: …\n\n<bodyText>" — the full copy-paste blob
}

// ── Touch 1: the cold outreach email ────────────────────────────────────────
//
// Three subject lines under an A/B/C test. The variant is chosen from a hash of
// the lead id rather than at random, so a given lead always renders the same
// subject — the Email Queue preview, the sent message and the outreach_log row
// can never disagree, and re-rendering is idempotent.
export const OUTREACH_SUBJECTS: ReadonlyArray<(company: string) => string> = [
  (c) => `${c} — that $300/mo software bill`,
  (c) => `Quick math for ${c}`,
  () => `Own your tech instead of renting it`,
];

/** Stable 0..n-1 bucket from a lead id (FNV-1a). */
export function subjectVariantIndex(leadId?: string | null): number {
  if (!leadId) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < leadId.length; i++) {
    h ^= leadId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % OUTREACH_SUBJECTS.length;
}

/** CAN-SPAM requires the recipient's own name never be injected as markup. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const DEMO_URL = "https://hvac-2026.vercel.app/dashboard";
export const CALENDLY_URL = "https://calendly.com/fullstackservicesllc";

// Touch-1 body. Fixed copy — deliberately NOT the AI-generated
// recommended_first_message, which only drives touches 2–3 now.
function outreachBodyParagraphs(ownerName: string): string[] {
  return [
    `Hi ${ownerName},`,
    `Quick one — most HVAC shops are paying $300–500 a month across scheduling, dispatch, invoicing, and a client portal. That's $6,000+ a year, and you own none of it.`,
    `I'm Peter with Full Stack Services LLC. We help HVAC owners save money every month by owning their tech instead of renting it. We started in Arizona and now work with companies across the country. It's one custom investment build — you own it forever, and it scales as your company grows without ever charging you more.`,
    `No subscriptions. No per-seat fees. No long-term lock-in.`,
    `You can click around a live HVAC dashboard we built here: ${DEMO_URL}`,
    `If you're doing 10+ jobs a month, a 30-minute call is worth it — free, no pitch. I'll look at what you're paying now, tell you exactly which tools to cancel, and give you a real build number before we hang up. If it doesn't make sense to build, I'll tell you that too.`,
    `Grab a time here: ${CALENDLY_URL}`,
    `— Peter\nFull Stack Services LLC\n${COMPANY_LOCATION_TAGLINE}\nfullstackservicesllc.net`,
  ];
}

const SUBJECTS: Record<number, (company: string) => string> = {
  2: (c) => `Follow-up: ${c}`,
  3: (c) => `Last message: ${c}`,
};

const HEADINGS: Record<number, string> = {
  2: "Hey,",
  3: "One final message,",
};

// Build the exact email for a lead given its position in the sequence and any
// AI-generated copy. Identical logic to what the cron send phase used inline,
// now shared so the manual queue shows precisely what would go out.
export function renderOutreachEmail(opts: {
  businessName: string;
  emailSentCount: number;
  firstMessage?: string | null;
  followUp?: string | null;
  /** Lead id — required for the footer's one-click unsubscribe link. */
  leadId?: string | null;
  /** Lead's owner_name. Blank/missing renders the "there" fallback. */
  ownerName?: string | null;
}): RenderedOutreachEmail {
  const company = opts.businessName;
  const emailNum = Math.min((opts.emailSentCount || 0) + 1, 3);
  const ownerName = (opts.ownerName || "").trim() || "there";

  // Touch 1 uses the fixed outreach copy; touches 2–3 keep the AI follow-up.
  if (emailNum === 1) {
    const subject = OUTREACH_SUBJECTS[subjectVariantIndex(opts.leadId)](company);
    const paras = outreachBodyParagraphs(ownerName);

    const html =
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color:#222; font-size:15px; line-height:1.6;">` +
      paras
        .map((p) =>
          `<p style="margin:0 0 16px;">` +
          esc(p)
            .replace(/\n/g, "<br>")
            .replace(DEMO_URL, `<a href="${DEMO_URL}">${DEMO_URL}</a>`)
            .replace(CALENDLY_URL, `<a href="${CALENDLY_URL}">${CALENDLY_URL}</a>`) +
          `</p>`
        )
        .join("") +
      footerHtml(opts.leadId) +
      `</div>`;

    const bodyText = `${paras.join("\n\n")}\n\n${footerText(opts.leadId)}`;
    return { emailNum, subject, html, bodyText, copyText: `Subject: ${subject}\n\n${bodyText}` };
  }

  const message =
    emailNum === 2
      ? opts.followUp ||
        `Following up on our previous message about custom software for ${company}.`
      : `Final follow-up: custom software solution for ${company}`;

  const subject = SUBJECTS[emailNum](company);
  const heading = HEADINGS[emailNum];

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>${heading}</h2><p style="color: #666; line-height: 1.6;">${message}</p>${footerHtml(opts.leadId)}</div>`;

  const bodyText = `${message}\n\n${footerText(opts.leadId)}`;
  const copyText = `Subject: ${subject}\n\n${bodyText}`;

  return { emailNum, subject, html, bodyText, copyText };
}
