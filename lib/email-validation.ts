import { promises as dns } from "dns";

// Guards against sending to addresses the website scraper invented.
//
// A live batch on 2026-08-17 bounced at 20%. The cause was not dead mailboxes —
// it was the scraper's email regex matching things that are not addresses at
// all. `logo@2x.png` (a retina image reference) became `chosen-sprite@2x.png`;
// Sentry's `sentry-next.wixpress.com` and URL-encoded fragments like
// `gmail.com%20` came through the same way. 16 of 103 scraped domains had no MX
// record whatsoever.
//
// Bounces cost sender reputation, so this rejects at BOTH ends: when enrichment
// captures an address, and again immediately before a send.

/** File extensions that appear as fake "TLDs" when an @2x image is mis-parsed. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|css|js)$/i;

/** Hosts belonging to tooling, never to a prospect. */
const JUNK_HOST =
  /(^|\.)(sentry|wixpress|kinsta\.cloud|wpengine|cloudfront|gravatar|googleusercontent|schema\.org|w3\.org)(\.|$)/i;

/** Scraper artefacts: percent-encoding, whitespace, or a mangled TLD run-on. */
const MANGLED = /%[0-9a-f]{2}|\s|\.(com|net|org)[a-z]{2,}$/i;

/** Placeholder / system addresses that are real but must never be mailed. */
const NON_PROSPECT =
  /^(no-?reply|do-?not-?reply|postmaster|abuse|mailer-daemon)@|@(example|test|invalid|localhost)\./i;

const ADDR = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Cheap synchronous checks. Catches every failure seen in the live batch
 * without a network call, so it is safe to run on every scraped candidate.
 */
export function looksLikeRealEmail(email?: string | null): boolean {
  const e = (email || "").trim();
  if (!e || e.length > 254) return false;
  if (!ADDR.test(e)) return false;
  if (MANGLED.test(e) || NON_PROSPECT.test(e)) return false;

  const domain = e.split("@").pop() || "";
  if (IMAGE_EXT.test(domain) || JUNK_HOST.test(domain)) return false;

  // A real TLD is alphabetic and at least two characters — `2x.png` is not.
  const tld = domain.split(".").pop() || "";
  return /^[a-z]{2,}$/i.test(tld);
}

// One lookup per domain per warm container. A batch commonly shares domains,
// and the negative answers are the ones worth remembering.
const mxCache = new Map<string, boolean>();

/** True when the domain publishes at least one MX record. */
export async function domainAcceptsMail(email: string): Promise<boolean> {
  const domain = (email.split("@").pop() || "").toLowerCase();
  if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain)!;

  let ok = false;
  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("mx timeout")), 4000)),
    ]);
    ok = Array.isArray(mx) && mx.length > 0;
  } catch {
    // NXDOMAIN, no MX, or timeout — all mean "do not send".
    ok = false;
  }
  mxCache.set(domain, ok);
  return ok;
}

/**
 * Full check used immediately before a send: syntax first (free), then MX.
 * Returns a reason string when the address must not be mailed, else null.
 */
export async function rejectionReason(email?: string | null): Promise<string | null> {
  if (!looksLikeRealEmail(email)) return "malformed or non-prospect address";
  return (await domainAcceptsMail(email!)) ? null : "domain has no MX record";
}
