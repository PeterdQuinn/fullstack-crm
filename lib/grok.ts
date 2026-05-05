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

async function callGrok(prompt: string): Promise<string> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-3",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`Grok error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

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

  const response = await callGrok(prompt);

  try {
    return JSON.parse(response);
  } catch (error) {
    console.error("Failed to parse Grok response:", response);
    throw new Error("Invalid Grok response format");
  }
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
  const prompt = `Classify this email reply from a prospect.

Reply: "${replyText}"

Respond ONLY with valid JSON (no markdown):
{
  "category": "Interested|Asked Price|Send Info|Too Busy|Not Interested|Wrong Person|Stop|Question",
  "recommended_action": "What to do next"
}`;

  const response = await callGrok(prompt);

  try {
    return JSON.parse(response);
  } catch (error) {
    console.error("Failed to parse reply classification:", response);
    return {
      category: "Question",
      recommended_action: "Review manually",
    };
  }
}
