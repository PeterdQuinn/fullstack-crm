import { getChain, runChainJson } from "@/lib/ai-providers";

interface ScoringResult {
  lead_score: number;
  confidence_level: "low" | "medium" | "high";
  main_pain_point?: string;
  best_attack_angle?: string;
  recommended_first_message?: string;
  recommended_follow_up?: string;
  missing_data_needed?: string[];
  provider?: string;
}

// Chain order for scoring lives in CHAINS.scoring (lib/ai-providers.ts).
//
// NOTE: the automation pipeline (lib/automation.ts) treats provider === "fallback"
// as "not a real judgment — never delete this lead". So a genuine model score is
// tagged with its provider name; only the hardcoded default below is "fallback".
// The longer chain makes that safety net fire less often — a lead now only
// escapes scoring when EVERY provider is down, not just Gemini.

export async function scoreLead(leadData: {
  business_name: string;
  owner_name?: string;
  industry?: string;
  current_software?: string;
  technologies?: string;
  short_description?: string;
}): Promise<ScoringResult> {
  const prompt = `Analyze this business and provide a sales strategy in JSON format:
Business: ${leadData.business_name}
Owner: ${leadData.owner_name || "Unknown"}
Industry: ${leadData.industry || "Unknown"}
Current Software: ${leadData.current_software || "None detected"}
Technologies: ${leadData.technologies || "Unknown"}
Description: ${leadData.short_description || "No description"}

Return ONLY valid JSON with these fields:
{
  "lead_score": <0-100>,
  "confidence_level": "<low|medium|high>",
  "main_pain_point": "<string>",
  "best_attack_angle": "<string>",
  "recommended_first_message": "<string>",
  "recommended_follow_up": "<string>",
  "missing_data_needed": [<array of strings>]
}`;

  console.log(`Scoring ${leadData.business_name} with available providers...`);

  const res = await runChainJson<ScoringResult>(getChain("scoring"), prompt, {
    label: "scoring",
    validate: (p) => !!p && typeof p === "object" && p.lead_score !== undefined,
  });

  if (res) {
    console.log(`✅ Scored with ${res.provider}`);
    return { ...res.data, provider: res.provider };
  }

  // Safe default when every provider failed — tagged "fallback" so automation
  // never deletes a lead on an uncertain (non-model) score. runChainJson has
  // already logged one error line naming every provider and its reason.
  console.warn("All AI providers failed, using default score");
  return {
    lead_score: 50,
    confidence_level: "low",
    main_pain_point: "Unable to determine",
    best_attack_angle: "Contact directly",
    recommended_first_message: `Hi ${leadData.business_name}, we help service businesses grow with custom software.`,
    recommended_follow_up: "Following up on our previous message.",
    missing_data_needed: ["owner_name", "industry", "description"],
    provider: "fallback",
  };
}
