import { hvacGaps, HvacSignals } from "@/lib/hvac-signals";
import { getChain, runChainJson } from "@/lib/ai-providers";

interface GrokSummary {
  main_pain_point: string;
  pain_reason: string;
  best_attack_angle: string;
  recommended_first_message: string;
  recommended_follow_up: string;
  lead_score: number;
  confidence_level: "low" | "medium" | "high";
  missing_data_needed: string[];
}

interface LeadData {
  business_name: string;
  owner_name?: string;
  short_description?: string;
  industry?: string;
  current_software?: string;
  monthly_spend_estimate?: string;
  technologies?: string;
}

// Chain order for drafting lives in CHAINS.drafting (lib/ai-providers.ts).

export async function generateLeadSummary(lead: LeadData): Promise<GrokSummary> {
  const sig = (lead as any).hvac_signals as HvacSignals | undefined;
  const gaps = sig ? hvacGaps(sig) : [];
  const yn = (v?: boolean) => (v === undefined ? "unknown" : v ? "yes" : "NO");

  const prompt = `You are a sales researcher for an agency that sells websites,
online booking and lead-capture systems to HVAC contractors. Analyze THIS
contractor and produce targeting intelligence a rep can act on today.

CONTRACTOR
Business: ${lead.business_name}
Owner: ${lead.owner_name || "Unknown"}
Location: ${[(lead as any).city, (lead as any).state].filter(Boolean).join(", ") || "Unknown"}
Google rating: ${(lead as any).google_rating ?? "Unknown"} from ${(lead as any).google_review_count ?? "Unknown"} reviews
Description: ${lead.short_description || "No info"}
Booking/dispatch software detected: ${lead.current_software || "none detected"}
Website tech: ${lead.technologies || "Unknown"}

WHAT THEIR WEBSITE SHOWS (read directly from their site — cite these, do not invent)
Online booking: ${yn(sig?.online_booking)}
24/7 emergency messaging: ${yn(sig?.emergency_24_7)}
Financing offered: ${yn(sig?.financing)}
Maintenance plan: ${yn(sig?.maintenance_plan)}
Mobile friendly: ${yn(sig?.mobile_friendly)}
Analytics/ad tracking: ${yn(sig?.runs_ads_or_tracking)}
Chat/instant capture: ${yn(sig?.chat_widget)}
Reviews on site: ${yn(sig?.review_widget)}
Brands carried: ${sig?.brands?.join(", ") || "none found"}
Certifications: ${sig?.certifications?.join(", ") || "none found"}
Services: ${sig?.services?.join(", ") || "none found"}
Market: ${sig?.segments?.join(", ") || "unknown"}
License: ${sig?.license_numbers?.join(", ") || "not shown"}

GAPS ALREADY DETECTED
${gaps.length ? gaps.map((g) => "- " + g).join("\n") : "- none detected"}

RULES
- Ground every claim in the website facts above. If something is unknown, say so
  rather than assuming.
- Money talk must be HVAC-specific: missed after-hours calls, unbooked tune-ups,
  stalled system-replacement quotes, seasonal swings, no recurring plan revenue.
- The first message must reference one concrete, verifiable thing about THIS
  contractor (a gap, a brand they carry, their review count) — never generic
  flattery.

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "main_pain_point": "The single biggest revenue leak, tied to a specific gap above",
  "pain_reason": "Why it costs them money in HVAC terms, with a rough dollar/job impact",
  "best_attack_angle": "The one offer to lead with and why it fits this contractor",
  "recommended_first_message": "Cold email under 150 words citing a specific verifiable detail",
  "recommended_follow_up": "Follow-up under 100 words with a different angle",
  "lead_score": 0-100,
  "confidence_level": "low|medium|high",
  "missing_data_needed": ["what to confirm before the call"]
}`;

  const res = await runChainJson<GrokSummary>(getChain("drafting"), prompt, {
    label: "drafting",
    validate: (p) => !!p && typeof p === "object" && typeof p.recommended_first_message === "string",
  });

  if (res) return res.data;

  // Rule-based fallback if the draft providers are down / return junk.
  // runChainJson has already logged one error line naming every provider and
  // its reason, so this is the safe default, not a silent swallow.
  console.warn("Draft providers unavailable, using rule-based fallback");
  const score = await scoreLead(lead);
  return {
    main_pain_point: `Using ${lead.current_software || "software"} without customization`,
    pain_reason: `Off-the-shelf software doesn't fit their exact workflow`,
    best_attack_angle: `Custom software built for their specific business`,
    recommended_first_message: `Hi ${lead.owner_name || "there"},\n\nI noticed ${lead.business_name} is using ${lead.current_software || "software"}. Most ${lead.industry || "businesses"} are paying $300-700/month on software they don't fully own.\n\nWe build custom solutions that save owners like you thousands per year.\n\nWorth a quick conversation?`,
    recommended_follow_up: `Just following up on my last message about custom software for ${lead.business_name}.\n\nMany businesses like yours have cut software costs in half by switching to owned solutions.\n\nLet me know if you're open to exploring it.`,
    lead_score: score,
    confidence_level: score > 70 ? "high" : score > 50 ? "medium" : "low",
    missing_data_needed: [],
  };
}

export async function scoreLead(lead: LeadData): Promise<number> {
  let score = 0;

  if (lead.owner_name) score += 15;
  if (lead.short_description) score += 15;
  if (lead.current_software) score += 15;
  if (lead.industry) score += 10;
  if (lead.monthly_spend_estimate) score += 10;
  if (lead.technologies) score += 10;

  return Math.min(score, 100);
}

// Chain order for classification lives in CHAINS.classification
// (lib/ai-providers.ts). It drives the autonomous booking path, so it is the
// chain that most needs the paid backstop rather than a "Question" default.

type ReplyCategory =
  | "Interested"
  | "Asked Price"
  | "Send Info"
  | "Too Busy"
  | "Not Interested"
  | "Wrong Person"
  | "Stop"
  | "Question";

// Small/fast models occasionally echo the enum (e.g. "Interested|Asked Price")
// instead of a single value. Coerce whatever the model returns to exactly one
// known category. Checked most-specific first so "Not Interested" wins over the
// substring "Interested". Falls back to "Question" (→ manual review).
const CATEGORY_PRIORITY: ReplyCategory[] = [
  "Not Interested",
  "Wrong Person",
  "Asked Price",
  "Send Info",
  "Too Busy",
  "Interested",
  "Stop",
  "Question",
];

function normalizeCategory(raw: unknown): ReplyCategory {
  const s = String(raw || "").toLowerCase();
  for (const cat of CATEGORY_PRIORITY) {
    if (s.includes(cat.toLowerCase())) return cat;
  }
  return "Question";
}

export async function classifyReply(
  replyText: string
): Promise<{
  category:
    | "Interested"
    | "Asked Price"
    | "Send Info"
    | "Too Busy"
    | "Not Interested"
    | "Wrong Person"
    | "Stop"
    | "Question";
  recommended_action: string;
}> {
  const prompt = `Classify this email reply from a prospect into exactly ONE category.

Reply: "${replyText}"

Choose exactly one category from this list:
Interested, Asked Price, Send Info, Too Busy, Not Interested, Wrong Person, Stop, Question

Respond ONLY with valid JSON (no markdown), the category being a single value:
{
  "category": "Interested",
  "recommended_action": "What to do next"
}`;

  // Order comes from CHAINS.classification (CLASSIFIER_PROVIDERS, with the
  // legacy REPLY_CLASSIFIER_PROVIDERS alias honored inside getChain).
  const res = await runChainJson<{ category?: unknown; recommended_action?: unknown }>(
    getChain("classification"),
    prompt,
    {
      label: "classification",
      validate: (p) => !!p && typeof p === "object" && p.category !== undefined,
    }
  );

  // Safe default: "Question" routes to manual review rather than triggering the
  // wrong automation (a bad "Interested" sends a booking link; a bad
  // "Not Interested" marks the lead Do Not Contact permanently).
  if (!res) {
    return { category: "Question", recommended_action: "Review manually" };
  }

  return {
    category: normalizeCategory(res.data.category),
    recommended_action:
      typeof res.data.recommended_action === "string" && res.data.recommended_action.trim()
        ? res.data.recommended_action
        : "Review manually",
  };
}
