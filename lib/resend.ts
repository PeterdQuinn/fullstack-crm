import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(
  email: string,
  subject: string,
  html: string,
  replyTo?: string
) {
  try {
    const result = await resend.emails.send({
      from: "noreply@fullstackservicesllc.net",
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
