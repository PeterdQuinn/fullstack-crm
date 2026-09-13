import { sendEmail } from "@/lib/resend";
import { COMPANY_MAILING_ADDRESS, mailingAddressConfigured } from "@/lib/email-templates";
import { BOOKING_URL, INSURANCE_WEBSITE, type InsuranceProspect, type InsuranceTrack } from "./types";
import { insuranceDb } from "./db";

// Outbound insurance email.
//
// This is a commercial message to a person who did not ask for it, which means
// every constraint the HVAC sequence lives under applies here too: a real
// postal address, a working one-click unsubscribe, a hard stop at three
// touches, and no send at all to anyone who has replied, bounced, complained or
// asked to be left alone.
//
// What is deliberately NOT said in this copy, because none of it can be
// supported at the moment a stranger receives it: any earnings figure, any
// promise of leads, any claim about carrier appointments, any statement about
// the recipient's licence status, and any suggestion that we know they are
// shopping for insurance. A search result is a reason to start a conversation,
// not a fact about a person.

export const INSURANCE_SENDER_NAME = "Peter Quinn";
const MAX_TOUCHES = 3;

/** The postal address in the footer. Falls back to the company's own. */
export const INSURANCE_MAILING_ADDRESS =
  process.env.INSURANCE_MAILING_ADDRESS?.trim() || COMPANY_MAILING_ADDRESS;

export function insuranceSendBlockedReason(): string | null {
  if (!mailingAddressConfigured() && !process.env.INSURANCE_MAILING_ADDRESS?.trim()) {
    return "CAN-SPAM: no physical postal address is configured for insurance outreach";
  }
  return null;
}

function appBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return raw.startsWith("https://") ? raw : "https://fullstack-crm-nine.vercel.app";
}

export function insuranceUnsubscribeUrl(prospectId: string): string {
  return `${appBaseUrl()}/api/email/unsubscribe?prospect_id=${encodeURIComponent(prospectId)}`;
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Words that mean the "name" is a page title, not a person. A discovered
// record is named after the source page until a human corrects it, so most of
// them start out as things like "Producer Directory Listing 2026".
const NOT_A_PERSON =
  /\b(agency|agencies|insurance|directory|listing|listings|profile|profiles|reviews?|best|top|near|find|search|results?|llc|inc|corp|company|group|associates|partners|services|solutions|agent|agents|producer|producers|broker|brokers|jobs?|hiring|careers?|about|contact|home|index|licen[cs]e[sd]?)\b/i;

/**
 * The recipient's first name, or "" when the record does not clearly hold one.
 *
 * Greeting a stranger by a word lifted out of a search-result title — "Hi
 * Producer," — is worse than not greeting them at all: it announces that
 * nobody read the record before mailing it. The bar is deliberately high, and
 * "Hi there," is a perfectly good fallback.
 */
export function personFirstName(name: string): string {
  const value = (name || "").trim();
  if (!value || /\d/.test(value) || NOT_A_PERSON.test(value)) return "";
  const parts = value.split(/\s+/);
  // A person is two or three words. One word is a handle or a company; four or
  // more is a headline.
  if (parts.length < 2 || parts.length > 3) return "";
  if (!parts.every((part) => /^[A-Z][a-z'’-]{1,20}\.?$/.test(part))) return "";
  return parts[0];
}

/** First name only, or a neutral greeting. A wrong name is worse than none. */
function greeting(name: string): string {
  const first = personFirstName(name);
  return first ? `Hi ${first},` : "Hi there,";
}

interface Touch {
  subject: string;
  paragraphs: string[];
}

function recruitingTouch(touch: number, name: string, state: string): Touch {
  const hello = greeting(name);
  if (touch === 1) {
    return {
      subject: "A quick question about your insurance practice",
      paragraphs: [
        hello,
        `I'm Peter Quinn. I work with life insurance producers in ${state}, and I'm reaching out to a small number of people about working together.`,
        "I'd rather ask than pitch: what would have to be true for your next move to be worth making?",
        "If that's a conversation worth ten minutes, my calendar is open below. If it isn't, no hard feelings — just say so and I'll leave you to it.",
      ],
    };
  }
  if (touch === 2) {
    return {
      subject: "Following up — your insurance practice",
      paragraphs: [
        hello,
        "Following up on my note. The short version of why I reach out to producers directly: most of the people I talk to aren't unhappy, they just have no idea what else is available to them.",
        "If you want to know what that looks like without committing to anything, a short call is the fastest way to find out.",
      ],
    };
  }
  return {
    subject: "Closing the loop",
    paragraphs: [
      hello,
      "Last note from me — I won't keep writing.",
      "If a conversation about your practice is ever worth having, reply to this and I'll pick it up from there. Either way, I hope the year treats you well.",
    ],
  };
}

function buyerTouch(touch: number, name: string, state: string): Touch {
  const hello = greeting(name);
  if (touch === 1) {
    return {
      subject: "Insurance questions, answered plainly",
      paragraphs: [
        hello,
        `I'm Peter Quinn, a licensed insurance agent working with families in ${state}.`,
        "I came across something you posted publicly and thought I'd offer: if you have questions about coverage, I'm happy to answer them plainly, with no obligation and no pressure to buy anything.",
        "If that's useful, you can grab a time below. If I've caught you at the wrong moment, just say so.",
      ],
    };
  }
  if (touch === 2) {
    return {
      subject: "Still happy to answer questions",
      paragraphs: [
        hello,
        "Following up on my note. The offer stands: questions answered, nothing sold.",
        "Most people I talk to want to understand what they're looking at before anyone quotes them a number. That conversation is free and takes about fifteen minutes.",
      ],
    };
  }
  return {
    subject: "Closing the loop",
    paragraphs: [
      hello,
      "Last note from me — I won't keep writing.",
      "If insurance questions come up later, reply to this and I'll help if I can.",
    ],
  };
}

export interface RenderedInsuranceEmail {
  touch: number;
  subject: string;
  html: string;
  bodyText: string;
  messageText: string;
}

export function renderInsuranceEmail(prospect: {
  id: string;
  name: string;
  track: InsuranceTrack;
  state: string;
  email_sent_count?: number;
}): RenderedInsuranceEmail {
  const touch = Math.min((prospect.email_sent_count || 0) + 1, MAX_TOUCHES);
  const stateName = prospect.state || "your state";
  const { subject, paragraphs } =
    prospect.track === "recruiting"
      ? recruitingTouch(touch, prospect.name, stateName)
      : buyerTouch(touch, prospect.name, stateName);

  const signature = [INSURANCE_SENDER_NAME, INSURANCE_WEBSITE];
  const unsubscribe = insuranceUnsubscribeUrl(prospect.id);

  const html =
    `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color:#222; font-size:15px; line-height:1.6;">` +
    paragraphs.map((p) => `<p style="margin:0 0 16px;">${esc(p)}</p>`).join("") +
    `<p style="margin:24px 0;"><a href="${BOOKING_URL}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">Find a time to talk →</a></p>` +
    signature.map((line) => `<p style="margin:0;">${esc(line)}</p>`).join("") +
    `<hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px;">` +
    `<p style="color:#999;font-size:12px;line-height:1.5;margin:0;">${esc(INSURANCE_SENDER_NAME)}<br>${esc(INSURANCE_MAILING_ADDRESS)}<br>` +
    `<a href="${unsubscribe}" style="color:#999;">Unsubscribe</a> from future emails.</p>` +
    `</div>`;

  const messageText = `${paragraphs.join("\n\n")}\n\nFind a time to talk: ${BOOKING_URL}\n\n${signature.join("\n")}`;
  const bodyText = `${messageText}\n\n${INSURANCE_SENDER_NAME}\n${INSURANCE_MAILING_ADDRESS}\nUnsubscribe: ${unsubscribe}`;

  return { touch, subject, html, bodyText, messageText };
}

export type SendRefusal =
  | "no email address"
  | "asked not to be contacted"
  | "address failed"
  | "already replied"
  | "sequence complete"
  | "stage is closed"
  | "not qualified yet";

/** Why this prospect may not be mailed right now, or null. */
export function sendRefusal(
  prospect: Pick<InsuranceProspect, "email" | "stage"> & {
    opt_out?: boolean;
    bounced?: boolean;
    complained?: boolean;
    replied_at?: string | null;
    email_sent_count?: number;
    score?: number | null;
  },
  minScore: number
): SendRefusal | null {
  if (!prospect.email?.trim()) return "no email address";
  if (prospect.opt_out || prospect.complained || prospect.stage === "Do not contact") return "asked not to be contacted";
  if (prospect.bounced) return "address failed";
  if (prospect.replied_at) return "already replied";
  if ((prospect.email_sent_count || 0) >= MAX_TOUCHES) return "sequence complete";
  if (["Not now", "Meeting booked", "Contracting", "Onboarding", "Active", "Application", "Policy issued"].includes(prospect.stage))
    return "stage is closed";
  // A record nobody and nothing has judged is not mailed.
  if (prospect.score == null || prospect.score < minScore) return "not qualified yet";
  return null;
}

/**
 * Send one touch, through the same transactional outbox the HVAC side uses.
 *
 * The outbox reserves against a shared daily budget, deduplicates on the
 * idempotency key, and commits the activity record, the sequence counter, the
 * stage change and the next task in one transaction (migration 020).
 */
export async function sendInsuranceTouch(
  prospect: InsuranceProspect & { email_sent_count?: number; score?: number | null },
  options: { dailyCap: number; minScore: number; source?: "owner" | "automation" }
): Promise<{ sent: boolean; reason?: string; touch?: number; messageId?: string }> {
  const blocked = insuranceSendBlockedReason();
  if (blocked) return { sent: false, reason: blocked };

  const refusal = sendRefusal(prospect, options.minScore);
  if (refusal) return { sent: false, reason: refusal };

  const rendered = renderInsuranceEmail(prospect);
  const db = insuranceDb();

  // The outbox row carries the prospect id so finalization can do the
  // bookkeeping inside the send transaction.
  const key = `ins-${prospect.id}-touch-${rendered.touch}`;
  const { error } = await db.from("email_outbox").upsert(
    {
      idempotency_key: key,
      insurance_prospect_id: prospect.id,
      message_type: `insurance_touch_${rendered.touch}`,
      recipient: prospect.email.trim(),
      sender: process.env.INSURANCE_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "peter@fullstackservicesllc.net",
      reply_to: process.env.INSURANCE_REPLY_TO || process.env.RESEND_FROM_EMAIL || "owner@fullstackservicesllc.net",
      subject: rendered.subject,
      html: rendered.html,
      body_text: rendered.bodyText,
      source: options.source || "automation",
      send_limit: options.dailyCap,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true }
  );
  if (error) throw new Error(`Insurance email not sent: could not save outgoing message: ${error.message}`);

  const result = await sendEmail(
    prospect.email.trim(),
    rendered.subject,
    rendered.html,
    undefined,
    key,
    { bodyText: rendered.bodyText, source: options.source || "automation", limit: options.dailyCap }
  );

  return { sent: true, touch: rendered.touch, messageId: result?.id };
}
