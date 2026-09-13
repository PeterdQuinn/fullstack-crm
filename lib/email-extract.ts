// Finding a business's email address in its own HTML.
//
// Measured against 20 live leads that had a website and no email on file, the
// previous extractor (mailto href, then a regex over `$("body").text()`) found
// nothing on 17 of them. The addresses were there; they were just not in the
// body text:
//
//   - Cloudflare's email obfuscation replaces the mailto with
//     `<a href="/cdn-cgi/l/email-protection#<hex>">[email protected]</a>`.
//     The address is XOR-encoded in the hex and never appears as text. 2 of 20
//     sites, on every page of the site.
//   - JSON-LD `Organization.email`, meta tags and data attributes are markup,
//     not body text, so a `.text()` scan cannot see them.
//   - "info [at] example [dot] com" is deliberately not an email until decoded.
//
// Ranking matters as much as finding. The old code took the FIRST regex match
// in document order, which is how `@2x.png` sprite references and a web
// designer's own address ended up mailed — a 20% bounce rate traced to exactly
// that. An address on the site's own domain is preferred over anything else.

/** Strict enough to reject sprite refs (`logo@2x.png`) and tracking hosts. */
const ADDRESS = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
const SCAN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g;

// Addresses that are never the business's inbox.
const JUNK =
  /(?:^|@).*(?:sentry\.|wixpress|\.png$|\.jpe?g$|\.gif$|\.svg$|\.webp$|\.css$|\.js$|example\.(?:com|org|net)|yourdomain|yourname|domain\.com|email\.com$|noreply|no-reply|donotreply|do-not-reply|@\d+x\b)/i;

// Placeholders a theme shipped with and nobody replaced: the local part is the
// literal word "email"/"your-email" on the site's own domain.
const PLACEHOLDER_LOCAL = /^(?:email|e-mail|your-?email|username|name|user)$/i;

// A shared inbox is the right target for cold outreach: it survives staff
// turnover and is the address the business publishes on purpose.
const ROLE = /^(?:info|contact|office|hello|sales|service|support|admin|scheduling|dispatch|estimates|inquiries|customerservice)$/i;

export interface FoundEmail {
  email: string;
  /** Where it came from — kept for logging so a bad source can be traced. */
  source: "cloudflare" | "mailto" | "jsonld" | "meta" | "text" | "obfuscated";
  /** Higher is better. See rank(). */
  score: number;
}

/**
 * Decode Cloudflare's email protection payload.
 *
 * The first byte is the XOR key; every following byte is one character of the
 * address. Returns null for anything that does not decode to an address.
 */
export function decodeCloudflareEmail(hex: string): string | null {
  const clean = (hex || "").trim().replace(/^#/, "");
  if (clean.length < 4 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  const key = parseInt(clean.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16) ^ key);
  }
  return ADDRESS.test(out) ? out : null;
}

/** `info [at] example [dot] com` -> `info@example.com`. */
function deobfuscate(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+|&#64;|&commat;)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*([a-zA-Z]{2,})/gi;
  for (const m of text.matchAll(pattern)) {
    const candidate = `${m[1]}@${m[2].replace(/\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*/gi, ".")}.${m[3]}`;
    if (ADDRESS.test(candidate)) found.push(candidate);
  }
  return found;
}

function decodeEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function usable(email: string): boolean {
  const value = email.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
  if (!ADDRESS.test(value)) return false;
  if (JUNK.test(value)) return false;
  if (PLACEHOLDER_LOCAL.test(value.split("@")[0])) return false;
  // A TLD is letters. `user@2x.png` already fails ADDRESS; this catches the
  // numeric-TLD shapes that a version string can produce.
  return /\.[a-zA-Z]{2,}$/.test(value);
}

// Consumer mailbox providers. A small operator really does run the business
// from a gmail address, so these are accepted even though they never match the
// site's domain — unlike a third-party COMPANY domain, which is the web
// designer, the CRM vendor or the franchise head office.
const CONSUMER_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "zoho.com", "comcast.net", "verizon.net",
  "sbcglobal.net", "att.net", "cox.net", "charter.net", "bellsouth.net", "earthlink.net",
]);

/** Registrable-ish host: drops `www.` and any deeper subdomain. */
function rootDomain(host: string): string {
  const parts = (host || "").toLowerCase().replace(/^www\./, "").split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : parts.join(".");
}

/**
 * True when this address plausibly belongs to the business whose site we read.
 *
 * A live run pulled `eben@eyebytes.com` off a contractor's homepage — the web
 * designer's own address in the footer credit. Mailing that is worse than
 * finding nothing: it is a stranger, it will never convert, and it burns
 * sending reputation. An address on a third-party company domain is therefore
 * rejected; the business's own domain and consumer mailboxes are not.
 */
function belongsToBusiness(email: string, siteHost?: string): boolean {
  if (!siteHost) return true; // directory/search results have no site to compare against
  const domain = rootDomain(email.split("@")[1] || "");
  return domain === rootDomain(siteHost) || CONSUMER_PROVIDERS.has(domain);
}

function rank(email: string, source: FoundEmail["source"], siteHost?: string): number {
  const [local, domain] = email.split("@");
  let score = 0;
  // An address on the company's own domain is the company's address. This is
  // the single strongest signal and outweighs where on the page it was found.
  if (siteHost && rootDomain(domain) === rootDomain(siteHost)) score += 100;
  if (ROLE.test(local)) score += 20;
  if (source === "cloudflare" || source === "mailto") score += 15;
  else if (source === "jsonld") score += 12;
  else if (source === "meta") score += 8;
  else if (source === "obfuscated") score += 5;
  // Free-provider inboxes are real but weaker than a domain address.
  if (/^(?:gmail|yahoo|hotmail|outlook|aol|icloud|live|msn)\./.test(`${domain}.`)) score -= 5;
  return score;
}

/**
 * Every address this HTML actually contains, best first.
 *
 * `siteHost` is the host of the page being read; addresses on that domain win.
 */
export function findEmails(html: string, siteHost?: string): FoundEmail[] {
  const candidates: FoundEmail[] = [];
  const add = (raw: string, source: FoundEmail["source"]) => {
    const email = (raw || "").trim().replace(/^mailto:/i, "").split("?")[0].trim();
    if (!usable(email)) return;
    if (!belongsToBusiness(email.toLowerCase(), siteHost)) return;
    candidates.push({ email: email.toLowerCase(), source, score: rank(email.toLowerCase(), source, siteHost) });
  };

  if (!html) return [];

  // 1. Cloudflare-protected addresses — invisible to any text scan.
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-fA-F]+)["']/g)) {
    const decoded = decodeCloudflareEmail(m[1]);
    if (decoded) add(decoded, "cloudflare");
  }
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/g)) {
    const decoded = decodeCloudflareEmail(m[1]);
    if (decoded) add(decoded, "cloudflare");
  }

  const decoded = decodeEntities(html);

  // 2. mailto links, entity-decoded (`&#109;ailto:` is a real obfuscation).
  for (const m of decoded.matchAll(/href\s*=\s*["']\s*mailto:([^"'>\s?]+)/gi)) add(m[1], "mailto");

  // 3. JSON-LD and other structured markup.
  for (const m of decoded.matchAll(/"email"\s*:\s*"([^"]+)"/gi)) add(m[1], "jsonld");
  for (const m of decoded.matchAll(/<meta[^>]+(?:name|property)=["']email["'][^>]+content=["']([^"']+)["']/gi)) add(m[1], "meta");
  for (const m of decoded.matchAll(/data-email=["']([^"']+)["']/gi)) add(m[1], "meta");

  // 4. Anything else written out in the markup, including inline scripts. This
  //    is the weakest source, which is what the ranking is for.
  for (const m of decoded.match(SCAN) || []) add(m, "text");

  // 5. Deliberately broken-up addresses.
  for (const value of deobfuscate(decoded.replace(/<[^>]+>/g, " "))) add(value, "obfuscated");

  const best = new Map<string, FoundEmail>();
  for (const item of candidates) {
    const existing = best.get(item.email);
    if (!existing || item.score > existing.score) best.set(item.email, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** The one address worth saving, or null. */
export function bestEmail(html: string, siteHost?: string): string | null {
  return findEmails(html, siteHost)[0]?.email ?? null;
}
