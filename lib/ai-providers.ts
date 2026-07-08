// Shared LLM provider layer. Each task type (reply classification, lead
// scoring, email drafting) picks its own ordered chain of providers via an env
// var — CLASSIFIER_PROVIDERS / SCORING_PROVIDERS / DRAFT_PROVIDERS — so the
// order can be re-tuned without touching code.
//
// Only providers with an API key configured are ever called: a chain entry
// whose key is missing is silently skipped. This keeps cheap/fast/free models
// first and only falls through to heavier ones when the earlier ones are down
// or rate-limited.
//
// Providers are registered here ONLY when a key exists in the environment.
// To add Cohere (scoring fallback) or Together (drafting fallback) later:
//   1. set COHERE_API_KEY / TOGETHER_API_KEY,
//   2. add a raw caller + registry entry below,
//   3. append the name to the relevant *_PROVIDERS env var.

export interface Provider {
  name: string;
  hasKey: () => boolean;
  call: (prompt: string) => Promise<string>;
}

// ── Key accessors (tolerate both the mixed-case names in .env.local and the
//    conventional SCREAMING_CASE forms) ──────────────────────────────────────
const groqKey = () => process.env.Groq_API_KEY || process.env.GROQ_API_KEY;
const cerebrasKey = () => process.env.Cerebras_API_KEY || process.env.CEREBRAS_API_KEY;
const mistralKey = () => process.env.Mistral_API_KEY || process.env.MISTRAL_API_KEY;
const geminiKey = () => process.env.GEMINI_API_KEY;
const ollamaKey = () => process.env.OLLAMA_API_KEY;

// ── Raw callers. Each returns the model's text output or throws. ────────────

// Generic OpenAI-compatible chat completion (Groq, Cerebras, Mistral all speak
// this). Low temperature for reliable JSON across all three task types.
async function openAICompatible(
  label: string,
  url: string,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${label} ${res.status} ${res.statusText} ${detail}`.trim());
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGroq(prompt: string): Promise<string> {
  const key = groqKey();
  if (!key) throw new Error("Groq_API_KEY not set");
  // llama-3.1-8b-instant = Groq's fastest free model, ideal for classification.
  return openAICompatible(
    "Groq",
    "https://api.groq.com/openai/v1/chat/completions",
    key,
    process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    prompt
  );
}

async function callCerebras(prompt: string): Promise<string> {
  const key = cerebrasKey();
  if (!key) throw new Error("Cerebras_API_KEY not set");
  return openAICompatible(
    "Cerebras",
    "https://api.cerebras.ai/v1/chat/completions",
    key,
    process.env.CEREBRAS_MODEL || "gpt-oss-120b",
    prompt
  );
}

async function callMistral(prompt: string): Promise<string> {
  const key = mistralKey();
  if (!key) throw new Error("Mistral_API_KEY not set");
  return openAICompatible(
    "Mistral",
    "https://api.mistral.ai/v1/chat/completions",
    key,
    process.env.MISTRAL_MODEL || "mistral-small-latest",
    prompt
  );
}

// Google Gemini — forced JSON output (responseMimeType) so callers can parse
// directly. Key auths via ?key= query param, NOT a Bearer header.
async function callGemini(prompt: string): Promise<string> {
  const apiKey = geminiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(
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
          // gemini-flash-latest maps to a 2.5 "thinking" model that otherwise
          // spends the whole token budget reasoning and returns no JSON.
          // Disable thinking so it answers directly (this is scoring/drafting,
          // not a task that needs chain-of-thought).
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status} ${res.statusText} ${detail}`.trim());
  }
  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ?? "";
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

// Ollama Cloud — only serves "-cloud" models; gpt-oss:120b-cloud is the free tier.
async function callOllama(prompt: string): Promise<string> {
  const key = ollamaKey();
  if (!key) throw new Error("OLLAMA_API_KEY not set");
  const baseUrl = process.env.OLLAMA_BASE_URL || "https://ollama.com";
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud",
      prompt,
      stream: false,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status} ${res.statusText} ${detail}`.trim());
  }
  const data = await res.json();
  return data.response ?? "";
}

// ── Registry: only providers that have a key wired in this batch. ───────────
export const PROVIDERS: Record<string, Provider> = {
  Groq: { name: "Groq", hasKey: () => !!groqKey(), call: callGroq },
  Cerebras: { name: "Cerebras", hasKey: () => !!cerebrasKey(), call: callCerebras },
  Mistral: { name: "Mistral", hasKey: () => !!mistralKey(), call: callMistral },
  Gemini: { name: "Gemini", hasKey: () => !!geminiKey(), call: callGemini },
  Ollama: { name: "Ollama", hasKey: () => !!ollamaKey(), call: callOllama },
};

// Resolve an ordered, key-present provider chain from an env value (falling
// back to `defaults`). Unknown names and keyless providers are dropped.
export function resolveChain(envValue: string | undefined, defaults: string[]): Provider[] {
  const requested = (envValue || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const names = requested.length > 0 ? requested : defaults;

  const chain: Provider[] = [];
  for (const name of names) {
    const p = PROVIDERS[name];
    if (!p) {
      console.warn(`AI provider "${name}" is not registered (no handler/key) — skipping`);
      continue;
    }
    if (!p.hasKey()) {
      console.warn(`AI provider "${name}" has no API key set — skipping`);
      continue;
    }
    chain.push(p);
  }
  return chain;
}

// Run a provider chain, returning the first non-empty response. Null if every
// provider is unavailable/failed (caller then uses its own fallback).
export async function runChain(
  chain: Provider[],
  prompt: string
): Promise<{ text: string; provider: string } | null> {
  for (const p of chain) {
    try {
      const text = await p.call(prompt);
      if (text && text.trim()) return { text, provider: p.name };
      console.warn(`${p.name} returned empty output — trying next provider`);
    } catch (err) {
      console.warn(`${p.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
