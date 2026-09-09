// Suppression is per channel, not per lead.
//
// A bounce says an address is dead. It does not say the business does not want
// to hear from you, and it does not disconnect their phone. Treating the two the
// same removed reachable businesses from every work queue: on live data, 24
// leads sat at "Bad Email" with a phone number on file, none of them opted out
// or complained, and "Bad Email" appeared in no queue's status list. They were
// simply gone.
//
// Two categories, and the difference matters:
//
//   PERMANENT   opt_out, complained — a person asked to be left alone. No
//               channel, ever. Legally this is about email; ethically the
//               request is broader, so it is honoured everywhere.
//
//   EMAIL ONLY  bounced, "Bad Email" — the address failed. Nobody asked for
//               anything. Call them, or find a better address.

export const EMAIL_FAILURE_STATUS = "Bad Email";

export interface SuppressionFlags {
  status?: string | null;
  opt_out?: boolean | null;
  bounced?: boolean | null;
  complained?: boolean | null;
}

/** A person asked not to be contacted. Blocks every channel. */
export function isPermanentlySuppressed(lead: SuppressionFlags): boolean {
  return Boolean(lead.opt_out) || Boolean(lead.complained) || lead.status === "Do Not Contact";
}

/** The email address is unusable, but the business may still be reachable. */
export function isEmailSuppressed(lead: SuppressionFlags): boolean {
  return Boolean(lead.bounced) || lead.status === EMAIL_FAILURE_STATUS;
}

/** True when a bad address is the only thing standing in the way of a call. */
export function isPhoneReachable(lead: SuppressionFlags & { phone?: string | null }): boolean {
  return !isPermanentlySuppressed(lead) && Boolean(lead.phone && lead.phone.trim());
}

export function suppressionReasons(lead: SuppressionFlags): string[] {
  const reasons: string[] = [];
  if (lead.complained) reasons.push("complained");
  if (lead.opt_out) reasons.push("opt_out");
  if (lead.bounced) reasons.push("bounced");
  if (lead.status === EMAIL_FAILURE_STATUS && !lead.bounced) reasons.push("bad_address");
  return reasons;
}
