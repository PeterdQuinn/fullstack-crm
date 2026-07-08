import { resolveChain, runChain } from "@/lib/ai-providers";

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

// Lead scoring (needs more reasoning, lower volume): Gemini first, then any
// fallbacks listed in SCORING_PROVIDERS. Cohere is the intended fallback but
// has no key yet, so it's not wired.
//
// NOTE: the automation pipeline (lib/automation.ts) treats provider === "fallback"
// as "not a real judgment — never delete this lead". So a genuine model score is
// tagged with its provider name; only the hardcoded default below is "fallback".
const SCORING_DEFAULT = ["Gemini"];

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

  const chain = resolveChain(process.env.SCORING_PROVIDERS, SCORING_DEFAULT);
  const res = await runChain(chain, prompt);

  if (res) {
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`✅ Scored with ${res.provider}`);
        return { ...parsed, provider: res.provider };
      } catch (error) {
        console.warn("Scoring JSON parse failed:", error);
      }
    }
  }

  // Fallback if all providers fail — tagged "fallback" so automation never
  // deletes a lead on an uncertain (non-model) score.
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
