#!/usr/bin/env node
/**
 * AI provider health check — provider × chain pass/fail matrix.
 *
 *   node scripts/ai-health-check.mjs            # every provider in every chain
 *   node scripts/ai-health-check.mjs --chain=classification
 *   node scripts/ai-health-check.mjs --provider=Anthropic
 *   node scripts/ai-health-check.mjs --json     # machine-readable
 *
 * Fires ONE real call per (provider, chain) pair using that chain's actual
 * prompt, then reports whether the call succeeded, whether the output parsed as
 * JSON through the same normalizer production uses, and how long it took.
 *
 * This deliberately bypasses the chain's fallthrough: each provider is called
 * on its own so a healthy provider earlier in the chain can't mask a broken one
 * behind it. A provider that is down (Anthropic on billing, say) is reported as
 * FAIL with its reason — it never crashes the run.
 *
 * Exit code is 0 unless --strict is passed, in which case any FAIL exits 1.
 * Without --strict a failing paid provider is informational, which is what you
 * want in CI where free-tier rate limits come and go.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Load .env.local (no dotenv dependency in this project) ──────────────────
function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) {
    console.error("No .env.local found — cannot health-check without API keys.");
    process.exit(1);
  }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

// ── Load the REAL provider layer, so this tests shipping code ───────────────
// The lib is TypeScript; compile the two files we need to a temp dir and import
// the output. Compiling (rather than reimplementing the calls here) is the
// whole point — a health check that duplicates the logic proves nothing.
const { execFileSync } = await import("node:child_process");
const OUT = path.join(ROOT, ".ai-healthcheck-build");

function buildLib() {
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "lib/ai-providers.ts",
      "--outDir", OUT,
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] }
  );
  // Rewrite the bare SDK specifier to an absolute path so plain node can
  // resolve it from the temp output directory.
  const built = path.join(OUT, "ai-providers.js");
  const sdk = path.join(ROOT, "node_modules", "@anthropic-ai", "sdk", "index.mjs");
  fs.writeFileSync(
    built,
    fs.readFileSync(built, "utf8").replace(/from ["']@anthropic-ai\/sdk["']/g, `from "${sdk}"`)
  );
  return built;
}

let providersModule;
try {
  providersModule = await import(`file://${buildLib()}`);
} catch (err) {
  console.error("Failed to compile lib/ai-providers.ts:", err.stderr?.toString?.() || err.message);
  process.exit(1);
}
const { PROVIDERS, CHAINS, extractJsonText, flattenTextParts } = providersModule;

// ── Per-chain probe prompts: the real prompt shape, minimal payload ─────────
const PROBES = {
  classification: {
    prompt: `Classify this email reply from a prospect into exactly ONE category.

Reply: "Sounds interesting, what does it cost?"

Choose exactly one category from this list:
Interested, Asked Price, Send Info, Too Busy, Not Interested, Wrong Person, Stop, Question

Respond ONLY with valid JSON (no markdown), the category being a single value:
{
  "category": "Interested",
  "recommended_action": "What to do next"
}`,
    validate: (p) => p && p.category !== undefined,
    shape: "category",
  },
  scoring: {
    prompt: `Analyze this business and provide a sales strategy in JSON format:
Business: Desert Air HVAC
Owner: Unknown
Industry: HVAC
Current Software: None detected
Technologies: Unknown
Description: Residential AC repair in Mesa AZ

Return ONLY valid JSON with these fields:
{
  "lead_score": <0-100>,
  "confidence_level": "<low|medium|high>",
  "main_pain_point": "<string>",
  "best_attack_angle": "<string>",
  "recommended_first_message": "<string>",
  "recommended_follow_up": "<string>",
  "missing_data_needed": [<array of strings>]
}`,
    validate: (p) => p && p.lead_score !== undefined,
    shape: "lead_score",
  },
  drafting: {
    prompt: `Analyze this business and generate a cold email sales summary.

Business: Desert Air HVAC
Owner: Unknown
Industry: HVAC
Description: Residential AC repair in Mesa AZ
Current Software: Unknown
Monthly Spend: Unknown
Technologies: Unknown

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
}`,
    validate: (p) => p && typeof p.recommended_first_message === "string",
    shape: "recommended_first_message",
  },
  cleanup: {
    prompt: `You are cleaning a combined list of business leads gathered from two sources.

1. DEDUPE: merge entries that refer to the same real business.
2. GAP-FILL: when merging, combine fields.
3. DISCARD junk: fake phones (555-01xx), placeholder emails, entries with no name.

Return ONLY a JSON object, no prose, in exactly this shape:
{
  "cleaned": [ { "business_name": "", "phone": "", "website": "", "email": "", "address": "", "city": "", "state": "", "niche": "" } ],
  "dropped": [ { "business_name": "", "reason": "" } ]
}
Use empty string for unknown fields. Do not invent data.

INPUT (2 businesses):
[{"business_name":"Desert Air HVAC","phone":"480-555-0102","website":"","city":"Mesa","state":"AZ","source":"google"},{"business_name":"Desert Air H.V.A.C.","phone":"","website":"desertair.com","city":"Mesa","state":"AZ","source":"osm"}]`,
    validate: (p) => p && Array.isArray(p.cleaned),
    shape: "cleaned[]",
  },
};

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const strict = args.includes("--strict");
const onlyChain = args.find((a) => a.startsWith("--chain="))?.split("=")[1];
const onlyProvider = args.find((a) => a.startsWith("--provider="))?.split("=")[1];

// ── Run one (provider, chain) probe ─────────────────────────────────────────
async function probe(providerName, chainName) {
  const provider = PROVIDERS[providerName];
  const { prompt, validate } = PROBES[chainName];
  const started = Date.now();

  if (!provider) {
    return { ok: false, ms: 0, reason: "provider not registered", stage: "config" };
  }
  if (!provider.hasKey()) {
    return { ok: false, ms: 0, reason: "no API key set", stage: "config" };
  }

  let raw;
  try {
    raw = await provider.call(prompt);
  } catch (err) {
    const msg = (err?.message || String(err)).replace(/\s+/g, " ");
    return { ok: false, ms: Date.now() - started, reason: truncate(msg, 110), stage: "call" };
  }

  const ms = Date.now() - started;

  if (!raw || !raw.trim()) {
    return { ok: false, ms, reason: "empty output", stage: "empty" };
  }

  const jsonText = extractJsonText(raw);
  if (!jsonText) {
    return {
      ok: false, ms, stage: "parse",
      reason: `no JSON in output: "${truncate(raw.replace(/\s+/g, " "), 70)}"`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, ms, stage: "parse", reason: `JSON.parse: ${truncate(err.message, 80)}` };
  }

  if (!validate(parsed)) {
    return {
      ok: false, ms, stage: "shape",
      reason: `parsed but missing ${PROBES[chainName].shape} (keys: ${Object.keys(parsed).join(",").slice(0, 60)})`,
    };
  }

  return { ok: true, ms, stage: "ok", reason: "" };
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ── Main ────────────────────────────────────────────────────────────────────
const chainNames = Object.keys(CHAINS).filter((c) => !onlyChain || c === onlyChain);
if (chainNames.length === 0) {
  console.error(`Unknown chain "${onlyChain}". Known: ${Object.keys(CHAINS).join(", ")}`);
  process.exit(1);
}

const results = {}; // chain -> provider -> result
const allProviders = new Set();

for (const chainName of chainNames) {
  // The chain's configured order, honoring env overrides exactly as production does.
  const cfg = CHAINS[chainName];
  const envOrder = (process.env[cfg.envVar] || process.env[cfg.legacyEnvVar] || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const order = (envOrder.length ? envOrder : cfg.defaults).filter(
    (p) => !onlyProvider || p === onlyProvider
  );

  results[chainName] = { order, envOrder: envOrder.length > 0, providers: {} };

  for (const providerName of order) {
    allProviders.add(providerName);
    if (!asJson) process.stderr.write(`  probing ${chainName} → ${providerName}… `);
    const r = await probe(providerName, chainName);
    results[chainName].providers[providerName] = r;
    if (!asJson) process.stderr.write(r.ok ? `ok ${r.ms}ms\n` : `FAIL (${r.stage})\n`);
  }
}

if (asJson) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
} else {
  printMatrix();
}

function printMatrix() {
  const providers = [...allProviders];
  const chains = chainNames;

  console.log("\n" + "═".repeat(78));
  console.log("  AI PROVIDER HEALTH CHECK — provider × chain");
  console.log("  " + new Date().toISOString());
  console.log("═".repeat(78) + "\n");

  const w = Math.max(10, ...providers.map((p) => p.length)) + 1;
  const col = 16;

  console.log("  " + "PROVIDER".padEnd(w) + chains.map((c) => c.slice(0, col - 1).padEnd(col)).join(""));
  console.log("  " + "─".repeat(w + col * chains.length));

  for (const p of providers) {
    let row = "  " + p.padEnd(w);
    for (const c of chains) {
      const r = results[c].providers[p];
      if (!r) row += "—".padEnd(col);
      else if (r.ok) row += `PASS ${r.ms}ms`.padEnd(col);
      else row += `FAIL ${r.stage}`.padEnd(col);
    }
    console.log(row);
  }

  console.log("\n  " + "─".repeat(w + col * chains.length));
  console.log("  PASS = call succeeded, output parsed as JSON, required field present\n");

  // Chain order + effective health
  console.log("  CHAIN ORDER (→ = fallthrough order, first healthy provider serves)\n");
  for (const c of chains) {
    const { order, envOrder } = results[c];
    const rendered = order
      .map((p) => (results[c].providers[p]?.ok ? p : `${p}✗`))
      .join(" → ");
    const healthy = order.filter((p) => results[c].providers[p]?.ok);
    const src = envOrder ? CHAINS[c].envVar : "code default";
    console.log(`    ${c.padEnd(15)} ${rendered}`);
    console.log(`    ${"".padEnd(15)} source: ${src} | healthy: ${healthy.length}/${order.length}` +
      (healthy.length === 0 ? "  ⚠️  CHAIN DEAD — task falls back to safe default" : ""));
  }

  // Failure detail
  const failures = [];
  for (const c of chains) {
    for (const [p, r] of Object.entries(results[c].providers)) {
      if (!r.ok) failures.push({ chain: c, provider: p, ...r });
    }
  }
  if (failures.length) {
    console.log("\n  FAILURE DETAIL\n");
    for (const f of failures) {
      console.log(`    ${f.provider} / ${f.chain} [${f.stage}]`);
      console.log(`      ${f.reason}`);
    }
  }

  const total = chains.reduce((n, c) => n + Object.keys(results[c].providers).length, 0);
  const passed = total - failures.length;
  console.log(`\n  TOTAL: ${passed}/${total} provider-chain pairs passing\n`);

  const deadChains = chains.filter(
    (c) => results[c].order.every((p) => !results[c].providers[p]?.ok)
  );
  if (deadChains.length) {
    console.log(`  ⚠️  DEAD CHAINS (no working provider): ${deadChains.join(", ")}\n`);
  }
}

if (strict) {
  const anyFail = chainNames.some((c) =>
    Object.values(results[c].providers).some((r) => !r.ok)
  );
  process.exit(anyFail ? 1 : 0);
}
