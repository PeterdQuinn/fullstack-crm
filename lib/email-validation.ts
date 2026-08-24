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

/**
 * Dummy addresses that ship inside website templates. These are the dangerous
 * kind: correct syntax on a domain with live MX, so every other check passes
 * and a real message goes out to nobody. `filler@godaddy.com` is GoDaddy's
 * stock template value and `user@domain.com` came off a live lead's site.
 */
const TEMPLATE_PLACEHOLDER =
  /^(filler@godaddy\.com|user@domain\.com|(you|email|info|name)@(example|domain|yourdomain|yourcompany|mydomain|yoursite|company)\.(com|net|org))$/i;

/** Domains that only ever appear as an unfilled template field. */
const PLACEHOLDER_DOMAIN =
  /@(yourcompany|yourdomain|mydomain|yoursite|yourbusiness)\.(com|net|org)$/i;

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
  if (TEMPLATE_PLACEHOLDER.test(e) || PLACEHOLDER_DOMAIN.test(e)) return false;

  const domain = e.split("@").pop() || "";
  if (IMAGE_EXT.test(domain) || JUNK_HOST.test(domain)) return false;

  // A real TLD is alphabetic and at least two characters — `2x.png` is not.
  const tld = domain.split(".").pop() || "";
  return /^[a-z]{2,}$/i.test(tld);
}

/** Domain suffixes we recognise when trimming a run-on scraped domain. */
const KNOWN_TLD = ["com", "net", "org", "biz", "info", "us", "co", "io", "dev", "app"];

/**
 * Repairs the scraper artefacts that make a live mailbox look undeliverable.
 *
 * These are not hypothetical. Every case below is one that parked a real,
 * reachable prospect in "Bad Email":
 *
 *   customercare@www.semperfiheatingcooling.com  ->  ...@semperfiheatingcooling.com
 *   modernhvactech@gmail.com%20                  ->  modernhvactech@gmail.com
 *   office@mondragonac.comLocations              ->  office@mondragonac.com
 *   airtrondataprivacy@resservices.com.Privacy   ->  ...@resservices.com
 *
 * The `www.` prefix and the CamelCase run-ons come from the scraper gluing a
 * page/nav label onto the address it matched. Validating the raw string treats
 * a formatting artefact as a dead domain, which is the expensive kind of wrong:
 * the lead is marked terminally and never retried.
 */
export function normalizeEmail(raw?: string | null): string {
  let e = (raw || "").trim();
  // Scraped hrefs arrive percent-encoded; "%20" is a trailing space, not a TLD.
  try {
    e = decodeURIComponent(e).trim();
  } catch {
    /* malformed escape: keep the original and let validation reject it */
  }

  const at = e.lastIndexOf("@");
  if (at < 1) return e;

  const local = e.slice(0, at).trim();
  let domain = e.slice(at + 1).trim();

  if (/^www\./i.test(domain)) domain = domain.slice(4);

  // Junk fused into the TLD label: "mondragonac.comLocations" -> ".com".
  // Case matters here, so this runs before the domain is lowercased.
  const fused = domain.match(
    new RegExp(`^(.*?\\.(?:${KNOWN_TLD.join("|")}))(?=[A-Z])`)
  );
  if (fused) domain = fused[1];

  // Junk appended as its own label: "resservices.com.Privacy" -> ".com".
  // Real domain labels are case-insensitive; a capitalised trailing label is a
  // scraped page name, never part of the address.
  const labels = domain.split(".");
  while (labels.length > 2 && /^[A-Z]/.test(labels[labels.length - 1])) labels.pop();
  domain = labels.join(".").toLowerCase().replace(/\.+$/, "");

  return `${local}@${domain}`;
}

// One lookup per domain per warm container. A batch commonly shares domains,
// and the negative answers are the ones worth remembering. Transient failures
// are deliberately NOT cached — caching a timeout turns a blip into a verdict
// that outlives the container.
const mxCache = new Map<string, boolean>();

/** Why a domain was judged unmailable, and whether that judgement is final. */
export type MxResult = { ok: true } | { ok: false; transient: boolean };

/**
 * Does this domain publish an MX record?
 *
 * Distinguishes an authoritative "no" (NXDOMAIN / no MX records) from a
 * transient one (timeout, SERVFAIL, refused). The old version folded both into
 * `false`, so one slow resolver on a cold start marked a good lead "Bad Email"
 * permanently, with no retry. `transient: true` means "ask again later",
 * never "condemn the lead".
 */
export async function checkDomainMx(email: string): Promise<MxResult> {
  const domain = (email.split("@").pop() || "").toLowerCase();
  if (!domain) return { ok: false, transient: false };
  const cached = mxCache.get(domain);
  if (cached !== undefined) return cached ? { ok: true } : { ok: false, transient: false };

  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(Object.assign(new Error("mx timeout"), { code: "ETIMEOUT" })), 4000)
      ),
    ]);
    const ok = Array.isArray(mx) && mx.length > 0;
    mxCache.set(domain, ok);
    return ok ? { ok: true } : { ok: false, transient: false };
  } catch (err) {
    // ENOTFOUND = domain does not exist, ENODATA = exists but publishes no MX.
    // Both are final. Everything else (ETIMEOUT, ESERVFAIL, EREFUSED, and any
    // unexpected error) is the resolver's problem, not the prospect's.
    const code = (err as NodeJS.ErrnoException)?.code || "";
    const authoritative = code === "ENOTFOUND" || code === "ENODATA";
    if (authoritative) mxCache.set(domain, false);
    return { ok: false, transient: !authoritative };
  }
}

/** Back-compat boolean form. Treats a transient failure as "do not send". */
export async function domainAcceptsMail(email: string): Promise<boolean> {
  return (await checkDomainMx(email)).ok;
}

/** Outcome of the full pre-send check. */
export type Mailability =
  | { ok: true; email: string }
  | { ok: false; email: string; reason: string; transient: boolean };

/**
 * Full check used immediately before a send: normalise, then syntax (free),
 * then MX. `email` on the result is the address that should actually be mailed.
 *
 * `transient: true` means the address could not be judged right now — skip the
 * lead and retry later. Callers must not write a terminal status for it.
 */
export async function checkMailability(raw?: string | null): Promise<Mailability> {
  const email = normalizeEmail(raw);
  if (!looksLikeRealEmail(email)) {
    return { ok: false, email, reason: "malformed or non-prospect address", transient: false };
  }
  const mx = await checkDomainMx(email);
  if (mx.ok) return { ok: true, email };
  return {
    ok: false,
    email,
    reason: mx.transient ? "MX lookup failed (temporary)" : "domain has no MX record",
    transient: mx.transient,
  };
}

/**
 * Reason string when the address must not be mailed, else null.
 * Retained for callers that only need the boolean-ish answer.
 */
export async function rejectionReason(email?: string | null): Promise<string | null> {
  const result = await checkMailability(email);
  return result.ok ? null : result.reason;
}
