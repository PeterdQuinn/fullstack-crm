// Which markets the approved outreach copy may be sent to.
//
// HISTORY, because the previous hard-coded `industry === "HVAC"` check looks
// arbitrary now: the touch-1 copy used to open "most HVAC shops are paying
// $300-500 a month", which reads as a mistake to anyone else, so automation.ts
// and send-batch both refused non-HVAC leads. Commit 11a356d then replaced that
// copy with the market-neutral "own vs rent your business software" sequence --
// it names scheduling, dispatch, invoicing and customer management, and never
// mentions a trade. The gate outlived its reason and left 20 scored, approved
// landscaping leads unmailable.
//
// This is a deliberate allowlist rather than "send to everyone": copy that is
// safe for two service trades is not automatically safe for a law firm or a
// restaurant. Widen it with OUTREACH_MARKETS; do not delete the gate.

const DEFAULT_MARKETS = "hvac,landscaping";

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
  return APPROVED_MARKETS.includes(leadMarket(lead));
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
