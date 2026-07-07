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

async function callHuggingFace(prompt: string): Promise<string> {
  const response = await fetch("https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HF_API_KEY}`,
    },
    body: JSON.stringify({
      inputs: prompt,
    }),
  });

  if (!response.ok) {
    throw new Error(`HF error: ${response.statusText}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data[0]?.generated_text || JSON.stringify(data[0]);
  }
  return JSON.stringify(data);
}

async function callTogether(prompt: string): Promise<string> {
  const response = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mistralai/Mistral-7B-Instruct-v0.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`Together error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOllama(prompt: string): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "https://ollama.com";
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
    },
    body: JSON.stringify({
      // Ollama's cloud API only serves "-cloud" models, and some (e.g.
      // kimi-k2.5:cloud) are subscription-gated and return 403. gpt-oss:120b-cloud
      // is the free tier model that lib/ai-scoring.ts already uses successfully.
      model: "gpt-oss:120b-cloud",
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.response;
}

// Google Gemini — uses forced JSON output (responseMimeType) so the caller can
// JSON.parse the result directly. Key auths via ?key= query param.
async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini error: ${response.status} ${response.statusText} ${detail}`.trim());
  }

  const data = await response.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
  if (!text) {
    throw new Error("Gemini returned no text");
  }
  return text;
}

// xAI Grok — OpenAI-compatible chat completions endpoint.
async function callGrok(prompt: string): Promise<string> {
  const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("GROK_API_KEY not set");
  }
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROK_MODEL || process.env.XAI_MODEL || "grok-3",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Grok error: ${response.status} ${response.statusText} ${detail}`.trim());
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Reliable classifier path: Anthropic (key is always configured in prod).
// Uses a small, fast model since reply classification is a short task.
async function callAnthropic(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
}

export async function generateLeadSummary(lead: LeadData): Promise<GrokSummary> {
  let response: string;

  try {
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

    try {
      response = await callHuggingFace(prompt);
    } catch (error) {
      console.warn("HF failed, trying Together:", error);
      response = await callTogether(prompt);
    }

    return JSON.parse(response);
  } catch (error) {
    console.warn("AI APIs failed, using rule-based fallback");
    const score = await scoreLead(lead);
    return {
      main_pain_point: `Using ${lead.current_software || "software"} without customization`,
      pain_reason: `Off-the-shelf software doesn't fit their exact workflow`,
      best_attack_angle: `Custom software built for their specific business`,
      recommended_first_message: `Hi ${lead.owner_name || "there"},\n\nI noticed ${lead.business_name} is using ${lead.current_software || "software"}. Most ${lead.industry || "businesses"} are paying $300-700/month on software they don't fully own.\n\nWe build custom solutions that save owners like you thousands per year.\n\nWorth a quick conversation?`,
      recommended_follow_up: `Just following up on my last message about custom software for ${lead.business_name}.\n\nMany businesses like yours have cut software costs in half by switching to owned solutions.\n\nLet me know if you're open to exploring it.`,
      lead_score: score,
      confidence_level: score > 70 ? "high" : score > 50 ? "medium" : "low",
      missing_data_needed: []
    };
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

// Every provider we know how to call for reply classification. Add new ones
// here; the active cascade is chosen by REPLY_CLASSIFIER_PROVIDERS (below).
const CLASSIFIER_PROVIDER_REGISTRY: Record<string, (p: string) => Promise<string>> = {
  Gemini: callGemini,
  Ollama: callOllama,
  Together: callTogether,
  Grok: callGrok,
  Anthropic: callAnthropic,
};

// Default cascade. Grok and Anthropic are intentionally OFF until their billing
// is active — re-enable them WITHOUT a code change by setting, e.g.:
//   REPLY_CLASSIFIER_PROVIDERS="Gemini,Ollama,Grok,Anthropic,Together"
const DEFAULT_CLASSIFIER_PROVIDERS = ["Gemini", "Ollama", "Together"] as const;

// Resolve the active provider cascade from the env flag, falling back to the
// default order. Unknown names are ignored; an empty/all-invalid list falls
// back to the default so classification never silently loses every provider.
function getClassifierProviders(): Array<[string, (p: string) => Promise<string>]> {
  const configured = (process.env.REPLY_CLASSIFIER_PROVIDERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const names = configured.length > 0 ? configured : [...DEFAULT_CLASSIFIER_PROVIDERS];

  const resolved = names
    .filter((name) => {
      const known = name in CLASSIFIER_PROVIDER_REGISTRY;
      if (!known) console.warn(`Unknown reply classifier provider ignored: "${name}"`);
      return known;
    })
    .map((name) => [name, CLASSIFIER_PROVIDER_REGISTRY[name]] as [string, (p: string) => Promise<string>]);

  if (resolved.length === 0) {
    return DEFAULT_CLASSIFIER_PROVIDERS.map(
      (name) => [name, CLASSIFIER_PROVIDER_REGISTRY[name]] as [string, (p: string) => Promise<string>]
    );
  }
  return resolved;
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

  const providers = getClassifierProviders();

  let response: string | null = null;
  for (const [name, fn] of providers) {
    try {
      response = await fn(prompt);
      break;
    } catch (err) {
      console.warn(`${name} classify failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (response === null) {
    console.error("All classify providers failed");
    return { category: "Question", recommended_action: "Review manually" };
  }

  // Models sometimes wrap JSON in ```json fences — strip them before parsing.
  const cleaned = response.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error("Failed to parse reply classification:", response);
    return {
      category: "Question",
      recommended_action: "Review manually",
    };
  }
}
