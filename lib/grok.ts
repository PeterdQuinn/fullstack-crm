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
  const prompt = `Analyze this business and generate a cold email sales summary.

Business: ${lead.business_name}
Owner: ${lead.owner_name || "Unknown"}
Industry: ${lead.industry || "Unknown"}
Description: ${lead.short_description || "No info"}
Current Software: ${lead.current_software || "Unknown"}
Monthly Spend: ${lead.monthly_spend_estimate || "Unknown"}
Technologies: ${lead.technologies || "Unknown"}

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "main_pain_point": "The #1 problem they likely have",
  "pain_reason": "Why this is their problem",
  "best_attack_angle": "How to position our solution",
  "recommended_first_message": "First email message (under 150 words)",
  "recommended_follow_up": "Follow-up message (under 100 words)",
  "lead_score": 0-100,
  "confidence_level": "low|medium|high",
  "missing_data_needed": ["list", "of", "missing", "info"]
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
