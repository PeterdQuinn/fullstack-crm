import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// CAN-SPAM-compliant footer appended to every outbound prospecting email:
// a working one-click unsubscribe link + a physical mailing address.
// Both requirements are legally mandatory for commercial email.
//   - Unsubscribe writes opt_out=true via /api/email/unsubscribe (no auth).
//   - Address is pulled from COMPANY_MAILING_ADDRESS (env).
export function emailFooter(leadId?: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const address =
    process.env.COMPANY_MAILING_ADDRESS || "Full Stack Services LLC";
  const unsubUrl = leadId && appUrl ? `${appUrl}/api/email/unsubscribe?lead=${encodeURIComponent(leadId)}` : null;

  return `<hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px;">
<p style="color:#999;font-size:12px;line-height:1.5;margin:0;">
${address}
${unsubUrl ? `<br><a href="${unsubUrl}" style="color:#999;">Unsubscribe</a> from these emails.` : ""}
</p>`;
}

export async function sendEmail(
  email: string,
  subject: string,
  html: string,
  replyTo?: string
) {
  try {
    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@fullstackservicesllc.net";
    const result = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject,
      html,
      replyTo: replyTo || "owner@fullstackservicesllc.net",
    });

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.data;
  } catch (error) {
    console.error("Resend error:", error);
    throw error;
  }
}

export async function sendBatch(emails: Array<{ to: string; subject: string; html: string }>) {
  const results = [];

  for (const email of emails) {
    try {
      const result = await sendEmail(email.to, email.subject, email.html);
      results.push({ success: true, email: email.to, messageId: result.id });
    } catch (error) {
      results.push({
        success: false,
        email: email.to,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}
