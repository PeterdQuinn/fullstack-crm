// Single source of truth for outbound outreach email rendering (automation
// emails 1–3 + the shared footer). Used by BOTH the cron send phase
// (lib/automation.ts) and the manual copy-paste Email Queue
// (app/api/email/queue) so the two never drift.
//
// Manual-send mode: the footer carries the physical mailing address (CAN-SPAM)
// and a "Reply STOP" opt-out instruction instead of a click-through unsubscribe
// link — opt-outs are handled by hand (see the banner on /crm/email-queue and
// the daily "mark Do Not Contact" step in /crm/leads).

export const COMPANY_NAME = "Full Stack Services LLC";
export const COMPANY_MAILING_ADDRESS =
  process.env.COMPANY_MAILING_ADDRESS || "535 E Southern Ave Ste 6, Mesa, AZ 85204";
export const UNSUBSCRIBE_LINE = "Reply STOP to unsubscribe from future emails.";

// HTML footer appended to every outbound email body.
export function footerHtml(): string {
  return `<hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px;">
<p style="color:#999;font-size:12px;line-height:1.5;margin:0;">
${COMPANY_NAME}<br>${COMPANY_MAILING_ADDRESS}<br>${UNSUBSCRIBE_LINE}
</p>`;
}

// Plain-text footer for the copy-paste view.
export function footerText(): string {
  return `${COMPANY_NAME}\n${COMPANY_MAILING_ADDRESS}\n${UNSUBSCRIBE_LINE}`;
}

export interface RenderedOutreachEmail {
  emailNum: number; // 1..3 (which touch in the sequence)
  subject: string;
  html: string; // full HTML email (used if/when actually sent)
  bodyText: string; // plain-text body incl. footer (for copy-paste)
  copyText: string; // "Subject: …\n\n<bodyText>" — the full copy-paste blob
}

const SUBJECTS: Record<number, (company: string) => string> = {
  1: (c) => `Custom Solution for ${c} - Let's Chat`,
  2: (c) => `Follow-up: ${c}`,
  3: (c) => `Last message: ${c}`,
};

const HEADINGS: Record<number, string> = {
  1: "Hi,",
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
}): RenderedOutreachEmail {
  const company = opts.businessName;
  const emailNum = Math.min((opts.emailSentCount || 0) + 1, 3);

  const message =
    emailNum === 1
      ? opts.firstMessage ||
        `Hi ${company}, we build custom software for service businesses like yours.`
      : emailNum === 2
      ? opts.followUp ||
        `Following up on our previous message about custom software for ${company}.`
      : `Final follow-up: custom software solution for ${company}`;

  const subject = SUBJECTS[emailNum](company);
  const heading = HEADINGS[emailNum];

  const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>${heading}</h2><p style="color: #666; line-height: 1.6;">${message}</p>${footerHtml()}</div>`;

  const bodyText = `${message}\n\n${footerText()}`;
  const copyText = `Subject: ${subject}\n\n${bodyText}`;

  return { emailNum, subject, html, bodyText, copyText };
}
