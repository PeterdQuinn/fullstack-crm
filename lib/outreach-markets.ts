// Business-neutral outreach supports any named niche. Explicit env lists can narrow it.
const DEFAULT_MARKETS = "*";

/**
 * Lowercased market names the current copy is approved for.
 *
 * Read from both env names on purpose. The send routes run on the server and
 * see OUTREACH_MARKETS; the lead workspace gates its Send button in the browser,
 * where a non-NEXT_PUBLIC_ var is undefined. Without the public name a custom
 * allowlist would apply on the server while the UI silently kept the default,
 * so the button and the API would disagree. Set BOTH when customising, or
 * neither to take the default.
 */
export const APPROVED_MARKETS: readonly string[] = (
  process.env.OUTREACH_MARKETS ||
  process.env.NEXT_PUBLIC_OUTREACH_MARKETS ||
  DEFAULT_MARKETS
)
  .split(",")
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean);

/**
 * A lead's market. `industry` is authoritative when set; discovery leaves it
 * null for some sources and fills only `niche`, which is why both are read.
 */
export function leadMarket(lead: { industry?: string | null; niche?: string | null }): string {
  return `${lead.industry || lead.niche || ""}`.trim().toLowerCase();
}

/** True when this lead's market is approved for the current outreach copy. */
export function marketApproved(lead: { industry?: string | null; niche?: string | null }): boolean {
  const market = leadMarket(lead);
  return Boolean(market) && (APPROVED_MARKETS.includes("*") || APPROVED_MARKETS.includes(market));
}

/** Reason string for a blocked send, or null when the market is approved. */
export function marketRejectionReason(lead: {
  industry?: string | null;
  niche?: string | null;
}): string | null {
  if (marketApproved(lead)) return null;
  const market = leadMarket(lead) || "unset";
  return `This outreach template is approved for ${APPROVED_MARKETS.join(", ")} leads only (this lead's market is "${market}")`;
}
