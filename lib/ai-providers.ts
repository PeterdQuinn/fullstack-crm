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
// To add a new provider:
//   1. set its API key env var,
//   2. add a raw caller + registry entry below,
//   3. append the name to the relevant *_PROVIDERS env var.
//
// Anthropic sits LAST in every chain: it is the only paid, always-available
// provider, so it catches whatever the free tiers drop rather than serving
// steady-state traffic.

import Anthropic from "@anthropic-ai/sdk";

export interface Provider {
  name: string;
  hasKey: () => boolean;
  /** Returns normalized flat text — never raw blocks. See flattenTextParts. */
  call: (prompt: string) => Promise<string>;
}

// ── Output normalization ────────────────────────────────────────────────────
// Providers disagree on response shape, and that disagreement is the single
// most likely source of a silent break:
//
//   Groq                       choices[0].message.content   -> flat string
//   Ollama                     response                     -> flat string
//   Gemini                     candidates[0].content.parts[] -> parts, some without text
//   Anthropic                  content[]                    -> blocks, INCLUDING
//                                                              thinking blocks
//                                                              (adaptive thinking
//                                                              is on by default
//                                                              on Opus 5)
//
// Every block/part-shaped provider funnels through flattenTextParts, so a chain
// behaves identically no matter who answered. Anything that is not a text part
// — Anthropic `thinking` / `redacted_thinking`, tool_use, Gemini parts carrying
// only inlineData — is dropped rather than stringified into the JSON payload.
const TEXT_PART_TYPES = new Set(["text", "output_text"]);

export function flattenTextParts(parts: unknown, label: string): string {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";

  const skipped: string[] = [];
  const text = parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const block = part as { type?: string; text?: string };

      // Gemini parts have no `type` discriminator — a part is a text part iff
      // it carries a string `text`. Block-shaped providers do have `type`, and
      // for those the type is authoritative: an Anthropic thinking block can
      // carry a `thinking` field and must never be concatenated in.
      if (typeof block.type === "string") {
        if (!TEXT_PART_TYPES.has(block.type)) {
          skipped.push(block.type);
          return "";
        }
        return block.text ?? "";
      }
      return typeof block.text === "string" ? block.text : "";
    })
    .join("");

  if (skipped.length > 0) {
    console.log(`${label}: skipped ${skipped.length} non-text block(s) [${[...new Set(skipped)].join(", ")}]`);
  }
  return text;
}

/**
 * Strip everything a model may wrap around its JSON and return the JSON text.
 *
 * Replaces four divergent per-caller extractors (a ```-fence stripper, two
 * `/\{[\s\S]*\}/` regexes, and an indexOf/lastIndexOf slice) with one rule, so
 * a provider that parses in one chain parses in all of them.
 *
 * Handles: markdown fences, leaked `<thinking>`/`<reasoning>` tags (a known
 * Opus-5 failure mode when thinking is disabled), and any prose before or after
 * the object. Returns null when there is no balanced JSON value at all.
 */
export function extractJsonText(raw: string): string | null {
  if (!raw) return null;

  let s = raw
    // Drop reasoning tags *with* their contents — that text is not JSON.
    .replace(/<(thinking|reasoning|scratchpad)>[\s\S]*?<\/\1>/gi, "")
    // Drop an unterminated opener (truncated output).
    .replace(/<(thinking|reasoning|scratchpad)>[\s\S]*$/i, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  // Scan for the first balanced {...} or [...], respecting strings/escapes so a
  // brace inside a value ("pain_point": "cost { high }") can't end it early.
  const open = s.search(/[{[]/);
  if (open === -1) return null;

  const opener = s[open];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }

  return null; // unbalanced — truncated mid-object
}

// ── Retry policy ────────────────────────────────────────────────────────────
// The raw fetch callers below had no retry at all: a single 429 or 502 burned
// the provider for the whole request and the chain fell through to the next
// one. Transient statuses now get bounded exponential backoff before the chain
// moves on. (The Anthropic SDK does this itself — see maxRetries below — so
// callAnthropic is deliberately NOT wrapped in this helper.)
const RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

class ProviderHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry `fn` on transient HTTP statuses and network errors. Anything else
// (401, 400, a bad model name) fails immediately — retrying a misconfiguration
// just wastes the request budget.
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retriable =
        err instanceof ProviderHttpError ? RETRY_STATUSES.has(err.status) : err instanceof TypeError;
      if (!retriable || attempt === MAX_ATTEMPTS) break;
      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(
        `${label} attempt ${attempt}/${MAX_ATTEMPTS} failed (${
          err instanceof Error ? err.message : err
        }) — retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

// ── Key accessors (tolerate both the mixed-case names in .env.local and the
//    conventional SCREAMING_CASE forms) ──────────────────────────────────────
const groqKey = () => process.env.Groq_API_KEY || process.env.GROQ_API_KEY;
const geminiKey = () => process.env.GEMINI_API_KEY;
const ollamaKey = () => process.env.OLLAMA_API_KEY;
const anthropicKey = () => process.env.ANTHROPIC_API_KEY;
const kablewyKey = () => process.env.KABLEWY_API;

// ── Raw callers. Each returns the model's text output or throws. ────────────

// Generic OpenAI-compatible chat completion (Groq speaks
// this). Low temperature for reliable JSON across all task types.
async function openAICompatible(
  label: string,
  url: string,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  return withRetry(label, async () => {
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
      throw new ProviderHttpError(
        res.status,
        `${label} ${res.status} ${res.statusText} ${detail}`.trim()
      );
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  });
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

// Google Gemini — forced JSON output (responseMimeType) so callers can parse
// directly.
//
// AUTH: Google issues two DIFFERENT credential shapes for this endpoint and
// they are NOT interchangeable:
//
//   AI Studio API key   "AIza..."  (39 chars)  -> ?key=<value> query param
//   OAuth access token  "AQ.Ab8..." / "ya29." -> Authorization: Bearer <value>
//
// The configured GEMINI_API_KEY in this project is the OAuth shape, so the
// original ?key=-only caller could never authenticate (401/403 on every call).
// We now detect the shape and use the matching scheme, which is what lets the
// existing credential work without swapping it out.
const AI_STUDIO_KEY_RE = /^AIza[0-9A-Za-z_-]{20,}$/;

export function geminiAuth(apiKey: string): { queryKey?: string; bearer?: string } {
  return AI_STUDIO_KEY_RE.test(apiKey) ? { queryKey: apiKey } : { bearer: apiKey };
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = geminiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const auth = geminiAuth(apiKey);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    (auth.queryKey ? `?key=${auth.queryKey}` : "");
  return withRetry("Gemini", async () => {
    const res = await fetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}),
        },
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
      throw new ProviderHttpError(
        res.status,
        `Gemini ${res.status} ${res.statusText} ${detail}`.trim()
      );
    }
    const data = await res.json();
    const text = flattenTextParts(data?.candidates?.[0]?.content?.parts, "Gemini");
    if (!text) throw new Error("Gemini returned no text");
    return text;
  });
}

// Ollama Cloud — only serves "-cloud" models; gpt-oss:120b-cloud is the free tier.
async function callOllama(prompt: string): Promise<string> {
  const key = ollamaKey();
  if (!key) throw new Error("OLLAMA_API_KEY not set");
  const baseUrl = process.env.OLLAMA_BASE_URL || "https://ollama.com";
  // Bounded so a hung cloud request can't consume a whole serverless function
  // budget. Default matches the timeout the discovery cleanup used when it
  // called Ollama directly, since that is the longest-running caller.
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS) || 110000;

  return withRetry("Ollama", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud",
          prompt,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ProviderHttpError(
          res.status,
          `Ollama ${res.status} ${res.statusText} ${detail}`.trim()
        );
      }
      const data = await res.json();
      return data.response ?? "";
    } finally {
      clearTimeout(timer);
    }
  });
}

// Kablewy — OpenAI-compatible chat-completions provider, configured entirely
// from the environment so the host can be corrected without a code change.
//
// VERIFIED 2026-08-15: the documented default host `api.kablewy.com` does NOT
// resolve (NXDOMAIN). `kablewy.com` 301s to `kablewy.ai`, which serves SPA HTML
// for every /api/v1/* path rather than a JSON API. So this provider is expected
// to fail until KABLEWY_BASE_URL points at a real OpenAI-compatible endpoint.
// That is deliberately harmless: Kablewy sits LAST in every chain (after the
// always-available paid Anthropic link), so it is only ever reached when every
// provider ahead of it has already failed.
async function callKablewy(prompt: string): Promise<string> {
  const key = kablewyKey();
  if (!key) throw new Error("KABLEWY_API not set");
  const baseUrl = (process.env.KABLEWY_BASE_URL || "https://api.kablewy.com/v1").replace(/\/+$/, "");
  return openAICompatible(
    "Kablewy",
    `${baseUrl}/chat/completions`,
    key,
    process.env.KABLEWY_MODEL || "kablewy-claude",
    prompt
  );
}

// Anthropic — the paid last-resort link in every chain. Uses the official SDK
// (@anthropic-ai/sdk), which handles its own retry/backoff on 429s and 5xx, so
// this caller is NOT wrapped in withRetry (that would multiply the attempts).
let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  const apiKey = anthropicKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey,
      maxRetries: MAX_ATTEMPTS - 1, // same total attempt budget as the fetch providers
    });
  }
  return anthropicClient;
}

async function callAnthropic(prompt: string): Promise<string> {
  const client = getAnthropicClient();
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5";

  const response = await client.messages.create({
    model,
    // Every task on this chain returns a small JSON object. On Claude Opus 5
    // thinking is ON by default and max_tokens caps thinking + response
    // TOGETHER — a 1024 budget like the other providers use would truncate the
    // answer mid-JSON. Low effort keeps the thinking short; the headroom below
    // makes sure the JSON still lands.
    max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS) || 4096,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });

  // Safety classifiers can decline with a normal 200 — check before reading
  // content, which is empty or partial on a refusal.
  if (response.stop_reason === "refusal") {
    throw new Error(
      `Anthropic refused the request (category: ${response.stop_details?.category ?? "unknown"})`
    );
  }

  // Adaptive thinking is ON by default on Opus 5, so `content` routinely holds
  // thinking blocks alongside the answer. flattenTextParts drops them by type —
  // concatenating them would inject reasoning prose into the JSON payload and
  // break every downstream parser.
  const text = flattenTextParts(response.content, "Anthropic");

  if (!text.trim()) {
    // All-thinking, no answer: max_tokens was consumed before the JSON landed.
    throw new Error(
      `Anthropic returned no text block (stop_reason: ${response.stop_reason}) — ` +
        `likely max_tokens exhausted by thinking; raise ANTHROPIC_MAX_TOKENS`
    );
  }
  return text;
}

// ── Registry: only providers that have a key wired in this batch. ───────────
export const PROVIDERS: Record<string, Provider> = {
  Groq: { name: "Groq", hasKey: () => !!groqKey(), call: callGroq },
  Gemini: { name: "Gemini", hasKey: () => !!geminiKey(), call: callGemini },
  Ollama: { name: "Ollama", hasKey: () => !!ollamaKey(), call: callOllama },
  Anthropic: { name: "Anthropic", hasKey: () => !!anthropicKey(), call: callAnthropic },
  Kablewy: { name: "Kablewy", hasKey: () => !!kablewyKey(), call: callKablewy },
};

// ── Chain configuration: THE single source of truth ─────────────────────────
// Every chain order lives here and nowhere else. Callers ask for a chain by
// task name (getChain("classification")) rather than passing their own defaults
// array, so the order cannot drift between this file and the call sites.
//
// Ordering rule, applied uniformly: free/capable first, then the paid
// always-available link, then the experimental one.
//
// The roster is IDENTICAL across all four chains, so there is one order to
// reason about rather than four:
//
//   CHAIN            ENV VAR                ORDER
//   ---------------  ---------------------  ------------------------------------------
//   classification   CLASSIFIER_PROVIDERS   Ollama → Groq → Gemini → Anthropic → Kablewy
//   scoring          SCORING_PROVIDERS      Ollama → Groq → Gemini → Anthropic → Kablewy
//   drafting         DRAFT_PROVIDERS        Ollama → Groq → Gemini → Anthropic → Kablewy
//   cleanup          CLEANUP_PROVIDERS      Ollama → Groq → Gemini → Anthropic → Kablewy
//
// Gemini sits ahead of Anthropic (free tier before paid) and is back in every
// chain now that the caller auto-detects OAuth-vs-API-key auth. Kablewy is the
// tail: unverified host (see callKablewy), so it must never be reached unless
// everything ahead of it — including paid Anthropic — has already failed.
//
// Per-provider model + tuning env vars (all optional):
//   GROQ_MODEL           default llama-3.1-8b-instant
//   GEMINI_MODEL         default gemini-flash-latest
//   OLLAMA_MODEL         default gpt-oss:120b-cloud
//   OLLAMA_BASE_URL      default https://ollama.com
//   OLLAMA_TIMEOUT_MS    default 110000
//   ANTHROPIC_MODEL      default claude-opus-5
//   ANTHROPIC_MAX_TOKENS default 4096  (must leave room for thinking + answer)
//   KABLEWY_BASE_URL     default https://api.kablewy.com/v1  (does NOT resolve today)
//   KABLEWY_MODEL        default kablewy-claude
//
// API keys (a chain entry with no key is skipped, not an error):
//   Groq_API_KEY | GROQ_API_KEY, GEMINI_API_KEY, OLLAMA_API_KEY,
//   ANTHROPIC_API_KEY, KABLEWY_API
const ROSTER = ["Ollama", "Groq", "Gemini", "Anthropic", "Kablewy"];

export const CHAINS = {
  classification: {
    envVar: "CLASSIFIER_PROVIDERS",
    // Also honors the legacy REPLY_CLASSIFIER_PROVIDERS alias (see getChain).
    legacyEnvVar: "REPLY_CLASSIFIER_PROVIDERS",
    defaults: ROSTER,
    description: "Reply classification — fast, high volume, 8-way categorization",
  },
  scoring: {
    envVar: "SCORING_PROVIDERS",
    defaults: ROSTER,
    description: "Lead scoring — more reasoning, lower volume",
  },
  drafting: {
    envVar: "DRAFT_PROVIDERS",
    defaults: ROSTER,
    description: "Email drafting / lead summaries — moderate reasoning, low volume",
  },
  cleanup: {
    envVar: "CLEANUP_PROVIDERS",
    defaults: ROSTER,
    description: "Discovery dedupe / gap-fill — one large payload, latency tolerant",
  },
} as const satisfies Record<
  string,
  { envVar: string; legacyEnvVar?: string; defaults: string[]; description: string }
>;

export type ChainName = keyof typeof CHAINS;

/** Resolve a task's chain from its configured env var, falling back to defaults. */
export function getChain(name: ChainName): Provider[] {
  const cfg = CHAINS[name];
  const legacy = "legacyEnvVar" in cfg ? process.env[cfg.legacyEnvVar as string] : undefined;
  return resolveChain(process.env[cfg.envVar] || legacy, [...cfg.defaults]);
}

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

export interface ChainAttempt {
  provider: string;
  error: string;
}

export interface ChainResult {
  text: string;
  provider: string;
  /** Providers that failed before this one succeeded. Empty on a first-try win. */
  failures: ChainAttempt[];
}

/**
 * Run a provider chain, returning the first non-empty response.
 *
 * Returns null only when EVERY provider in the chain was unavailable or failed
 * (the caller then applies its own non-AI fallback). Failures are never
 * swallowed: each one is logged as it happens, and a total wipeout is logged at
 * error level with the full per-provider reason list so an outage is
 * diagnosable from the logs rather than showing up as a silent fallback score.
 */
export async function runChain(chain: Provider[], prompt: string): Promise<ChainResult | null> {
  const failures: ChainAttempt[] = [];

  if (chain.length === 0) {
    console.error("AI chain is empty — no configured provider has an API key set.");
    return null;
  }

  for (const p of chain) {
    try {
      const text = await p.call(prompt);
      if (text && text.trim()) {
        if (failures.length > 0) {
          console.warn(
            `AI chain recovered on ${p.name} after ${failures.length} failure(s): ` +
              failures.map((f) => `${f.provider}: ${f.error}`).join(" | ")
          );
        }
        return { text, provider: p.name, failures };
      }
      const message = "returned empty output";
      failures.push({ provider: p.name, error: message });
      console.warn(`${p.name} ${message} — trying next provider`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ provider: p.name, error: message });
      console.warn(`${p.name} failed: ${message} — trying next provider`);
    }
  }

  console.error(
    `All ${chain.length} AI provider(s) failed: ` +
      failures.map((f) => `${f.provider}: ${f.error}`).join(" | ")
  );
  return null;
}

export interface ChainJsonResult<T> {
  data: T;
  provider: string;
  failures: ChainAttempt[];
}

/**
 * Run a chain and return PARSED JSON, normalized identically for every provider.
 *
 * This is what all four task chains use. Two behaviors matter:
 *
 * 1. Normalization is centralized. The response text — already flattened from
 *    blocks/parts by the provider layer — goes through extractJsonText, so
 *    fences, leaked reasoning tags, and surrounding prose are handled the same
 *    way regardless of who answered.
 *
 * 2. **Unparseable output is a provider failure, not a chain failure.** The old
 *    per-caller code took the first non-empty *text* and gave up if it didn't
 *    parse — so one provider returning prose skipped every healthy provider
 *    behind it and dropped straight to the hardcoded fallback. Here a parse
 *    failure is recorded and the chain moves on, which is the whole point of
 *    having Anthropic at the back.
 *
 * Returns null only when every provider failed, returned empty, or produced
 * unparseable output. Callers then apply their own task-specific safe default.
 */
export async function runChainJson<T = any>(
  chain: Provider[],
  prompt: string,
  opts: { label: string; validate?: (parsed: any) => boolean }
): Promise<ChainJsonResult<T> | null> {
  const failures: ChainAttempt[] = [];

  if (chain.length === 0) {
    console.error(`[${opts.label}] AI chain is empty — no configured provider has an API key set.`);
    return null;
  }

  for (const p of chain) {
    try {
      const raw = await p.call(prompt);

      if (!raw || !raw.trim()) {
        failures.push({ provider: p.name, error: "returned empty output" });
        console.warn(`[${opts.label}] ${p.name} returned empty output — trying next provider`);
        continue;
      }

      const jsonText = extractJsonText(raw);
      if (!jsonText) {
        const preview = raw.replace(/\s+/g, " ").slice(0, 160);
        failures.push({ provider: p.name, error: `no JSON found in output (got: "${preview}")` });
        console.warn(`[${opts.label}] ${p.name} returned no parseable JSON — trying next provider`);
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ provider: p.name, error: `JSON.parse failed: ${message}` });
        console.warn(`[${opts.label}] ${p.name} JSON.parse failed: ${message} — trying next provider`);
        continue;
      }

      if (opts.validate && !opts.validate(parsed)) {
        failures.push({ provider: p.name, error: "JSON parsed but failed shape validation" });
        console.warn(
          `[${opts.label}] ${p.name} returned JSON of the wrong shape — trying next provider`
        );
        continue;
      }

      if (failures.length > 0) {
        console.warn(
          `[${opts.label}] recovered on ${p.name} after ${failures.length} failure(s): ` +
            failures.map((f) => `${f.provider}: ${f.error}`).join(" | ")
        );
      }
      return { data: parsed as T, provider: p.name, failures };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ provider: p.name, error: message });
      console.warn(`[${opts.label}] ${p.name} failed: ${message} — trying next provider`);
    }
  }

  // Uniform total-failure contract: exactly one error line naming every
  // provider and its reason. The caller returns its safe default after this.
  console.error(
    `[${opts.label}] All ${chain.length} AI provider(s) failed — falling back to safe default: ` +
      failures.map((f) => `${f.provider}: ${f.error}`).join(" | ")
  );
  return null;
}
