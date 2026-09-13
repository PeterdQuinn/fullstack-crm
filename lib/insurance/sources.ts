// Which search results are worth keeping, and what you can actually do with one.
//
// The first live run made the problem obvious. The recruiting query returned ten
// LinkedIn profiles: excellent at saying WHO someone is, and incapable of ever
// giving up a way to reach them — LinkedIn answers a scraper with HTTP 999. The
// buyers query returned ten SEO pages — quote farms, "Best Life Insurance in
// Arizona 2026" listicles, competitors' landing pages — with no person behind
// any of them. Twenty records, zero contactable leads.
//
// So a source is judged twice here: is it worth importing at all, and if it is,
// how would you reach the person behind it. A record you cannot act on is not a
// lead, it is a row.

export type SourceKind =
  /** A named individual, but the site will not surrender contact details (LinkedIn). Work by hand. */
  | "profile"
  /** A business's own site — the one kind that routinely publishes an address and a phone. */
  | "agency"
  /** A listing about a person on someone else's site. Often carries a phone. */
  | "directory"
  /** An article, a quote farm, a listicle. Never a person. */
  | "content";

/**
 * Domains that cannot produce a lead, whatever the query was.
 *
 * Quote farms and comparison sites exist to capture the same buyer you want, so
 * they rank for every buyer-intent phrase and contain no one. Job boards list
 * employers, not producers. Importing these burns a search request and fills the
 * board with rows that score 10 and sit at Research forever.
 */
export const EXCLUDED_DOMAINS: readonly string[] = [
  // Quote farms and comparison/aggregator sites
  "quickquote.com", "policygenius.com", "insurify.com", "thezebra.com", "nerdwallet.com",
  "valuepenguin.com", "bankrate.com", "investopedia.com", "insuranceopedia.com", "smartfinancial.com",
  "insure.com", "trustedchoice.com", "selectquote.com", "ethos.com", "ladderlife.com",
  "financial-advisorpro.com", "findassurance.com", "insuredbetter.com", "arizonalifeinsurance360.com",
  // Carriers and national brands — not a recruiting target, not a buyer
  "statefarm.com", "allstate.com", "progressive.com", "geico.com", "nationwide.com",
  "newyorklife.com", "massmutual.com", "northwesternmutual.com", "prudential.com", "aflac.com",
  "farmers.com", "libertymutual.com", "guardianlife.com", "transamerica.com", "mutualofomaha.com",
  // Job boards and review aggregators about employers
  "indeed.com", "ziprecruiter.com", "glassdoor.com", "monster.com", "simplyhired.com",
  // General reference and news
  "wikipedia.org", "reddit.com", "quora.com", "youtube.com", "pinterest.com",
];

const PROFILE_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "threads.net"];
const DIRECTORY_HOSTS = [
  "experience.com", "yelp.com", "bbb.org", "manta.com", "alignable.com", "thumbtack.com",
  "expertise.com", "birdeye.com", "chamberofcommerce.com", "agentreview.net", "healthmarkets.com",
  "mapquest.com", "superpages.com", "yellowpages.com", "angi.com",
];

/** Everything after `www.`, lowercased. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matches(host: string, list: readonly string[]): boolean {
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** False when this result can never become a lead. */
export function isImportable(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return !matches(host, EXCLUDED_DOMAINS);
}

/** What kind of page this is, which decides how the record can be worked. */
export function sourceKind(url: string): SourceKind {
  const host = hostOf(url);
  if (!host) return "content";
  if (matches(host, PROFILE_HOSTS)) return "profile";
  if (matches(host, DIRECTORY_HOSTS)) return "directory";
  // A path that reads like an article is content wherever it lives.
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  if (/\/(blog|news|article|guide|resources|best-|top-\d|compare|reviews-of)/.test(path)) return "content";
  return "agency";
}

/**
 * Search phrasing that biases toward pages carrying a way to reach someone.
 *
 * Used when the owner has saved no queries of their own. These are deliberately
 * plain: the hosted search API this runs on returned nothing at all for queries
 * loaded with quotes and OR operators, so the phrasing does the targeting rather
 * than the syntax.
 *
 * The recruiting set aims at agency team pages and local directories, which
 * publish a phone and often an address, instead of at profile networks that
 * publish neither. The two profile-network queries are kept on purpose — those
 * records identify a real producer better than anything else, and the workspace
 * now says plainly that they are a call, not an email.
 */
export const DEFAULT_QUERIES: Record<string, readonly string[]> = {
  recruiting: [
    "independent insurance agency {state} meet our team agents contact",
    "life insurance agency {state} our agents phone email",
    "insurance producer {state} agency profile contact information",
    "final expense insurance agent {state} contact",
    "licensed life insurance agent {state} about me contact",
    "insurance agent {state} chamber of commerce member directory",
    "life insurance producer {state} linkedin profile",
    "medicare insurance agent {state} independent agency team",
  ],
  buyers: [
    "life insurance agent {state} client questions consultation request",
    "final expense coverage {state} family asking about options",
    "{state} small business owner group benefits question",
  ],
};

/** Fill a query template for a state. */
export function buildQuery(template: string, stateName: string): string {
  return template.replace(/\{state\}/g, stateName);
}

/** How the owner would reach this record today. */
export function reachability(record: { email?: string | null; phone?: string | null; source?: { url?: string } | null }): {
  channel: "email" | "phone" | "manual";
  note: string;
} {
  if (record.email?.trim()) return { channel: "email", note: "Can be sequenced" };
  if (record.phone?.trim()) return { channel: "phone", note: "Call — no address published" };
  const kind = sourceKind(record.source?.url || "");
  return {
    channel: "manual",
    note: kind === "profile"
      ? "Profile network — message them there, no address is published"
      : "No contact details found yet",
  };
}
