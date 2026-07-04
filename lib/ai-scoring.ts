import Anthropic from "@anthropic-ai/sdk";

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

// Primary provider. Uses the official Anthropic SDK (api.anthropic.com).
// Tags results as "claude" so the automation pipeline treats them as a real
// score (not the never-delete fallback path).
async function scoreWithClaude(prompt: string): Promise<ScoringResult | null> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return null;

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    return { ...result, provider: "claude" };
  } catch (error) {
    console.error("Claude scoring failed:", error);
    return null;
  }
}

async function scoreWithHuggingFace(prompt: string): Promise<ScoringResult | null> {
  try {
    if (!process.env.HF_API_KEY) return null;

    const response = await fetch("https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HF_API_KEY}`,
      },
      body: JSON.stringify({ inputs: prompt }),
    });

    if (!response.ok) {
      console.warn(`HuggingFace error: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const text = Array.isArray(data) ? data[0]?.generated_text || "" : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    return { ...result, provider: "HuggingFace" };
  } catch (error) {
    console.error("HuggingFace scoring failed:", error);
    return null;
  }
}

async function scoreWithTogether(prompt: string): Promise<ScoringResult | null> {
  try {
    if (!process.env.TOGETHER_API_KEY) return null;

    const response = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      },
      body: JSON.stringify({
        model: "meta-llama/Llama-2-7b-chat-hf",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.warn(`Together API error: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    return { ...result, provider: "Together" };
  } catch (error) {
    console.error("Together scoring failed:", error);
    return null;
  }
}

async function scoreWithOllama(prompt: string): Promise<ScoringResult | null> {
  try {
    if (!process.env.OLLAMA_API_KEY || !process.env.OLLAMA_BASE_URL) return null;

    const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: "neural-chat",
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      console.warn(`Ollama error: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const text = data.response || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    return { ...result, provider: "Ollama" };
  } catch (error) {
    console.error("Ollama scoring failed:", error);
    return null;
  }
}

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

  // Try providers in order of preference: Ollama first, then Claude, then the
  // remaining fallbacks. Each returns null if unconfigured or on failure.
  const providers = [
    () => scoreWithOllama(prompt),
    () => scoreWithClaude(prompt),
    () => scoreWithTogether(prompt),
    () => scoreWithHuggingFace(prompt),
  ];

  for (const provider of providers) {
    const result = await provider();
    if (result) {
      console.log(`✅ Scored with ${result.provider}`);
      return result;
    }
  }

  // Fallback if all fail
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
