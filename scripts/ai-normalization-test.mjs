#!/usr/bin/env node
/**
 * Normalization contract test — runs WITHOUT any API credits.
 *
 * The Anthropic path cannot be exercised end-to-end while the key is
 * billing-blocked, and it is the riskiest path in the layer: it is the only
 * provider that returns content BLOCKS, and with adaptive thinking on by
 * default on Opus 5 those blocks routinely include `thinking` entries that must
 * never reach the JSON parser.
 *
 * So instead of trusting it, this pins the contract against real response
 * shapes for every provider: feed each provider's actual wire shape through the
 * SAME exported normalizers production uses, and assert every one yields the
 * identical parsed object.
 *
 *   node scripts/ai-normalization-test.mjs
 *
 * Exits 1 on any failure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".ai-healthcheck-build");

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync(
  "npx",
  ["tsc", "lib/ai-providers.ts", "--outDir", OUT, "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck", "--esModuleInterop"],
  { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] }
);
const built = path.join(OUT, "ai-providers.js");
const sdk = path.join(ROOT, "node_modules", "@anthropic-ai", "sdk", "index.mjs");
fs.writeFileSync(built, fs.readFileSync(built, "utf8")
  .replace(/from ["']@anthropic-ai\/sdk["']/g, `from "${sdk}"`));

const { flattenTextParts, extractJsonText } = await import(`file://${built}`);

let pass = 0, fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push({ name, actual: a, expected: e }); console.log(`  ✗ ${name}`); }
}

// The canonical payload every chain expects back, whoever answered.
const EXPECTED = { category: "Asked Price", recommended_action: "Send pricing" };

const normalize = (wire, label) => {
  const text = flattenTextParts(wire, label);
  const json = extractJsonText(text);
  return json === null ? null : JSON.parse(json);
};

const PAYLOAD = '{"category": "Asked Price", "recommended_action": "Send pricing"}';

console.log("\n── Provider wire shapes → identical parsed object ──\n");

// Groq: choices[0].message.content is already flat text.
check("Groq (flat string)", normalize(PAYLOAD, "Groq"), EXPECTED);

// Ollama: `response` is flat text, frequently fenced.
check("Ollama (fenced)", normalize("```json\n" + PAYLOAD + "\n```", "Ollama"), EXPECTED);

// Gemini: parts[], no `type` discriminator; a part may carry inlineData only.
check("Gemini (parts[], no type key)", normalize(
  [{ text: '{"category": "Asked Price",' }, { text: ' "recommended_action": "Send pricing"}' }],
  "Gemini"
), EXPECTED);
check("Gemini (part with inlineData and no text)", normalize(
  [{ inlineData: { mimeType: "image/png", data: "AAAA" } }, { text: PAYLOAD }],
  "Gemini"
), EXPECTED);

// Generic block-shaped provider (type:"text"). Cohere used this shape before it
// was deregistered; kept as coverage because Anthropic uses the same envelope.
check("block-shaped (type:text)", normalize([{ type: "text", text: PAYLOAD }], "blocks"), EXPECTED);

// ── Anthropic: THE unverified path ─────────────────────────────────────────
// Real Opus-5 shape with adaptive thinking on. The thinking block carries a
// `thinking` field, NOT `text` — but a naive `.map(b => b.text ?? "")` over the
// union would still be wrong the moment a block type gains a `text` field, so
// the normalizer filters by type.
check("Anthropic (thinking block + text block)", normalize([
  { type: "thinking", thinking: "The user is asking about price. Category is Asked Price.", signature: "abc" },
  { type: "text", text: PAYLOAD },
], "Anthropic"), EXPECTED);

check("Anthropic (multiple thinking blocks, split text)", normalize([
  { type: "thinking", thinking: "First consider the options." },
  { type: "thinking", thinking: "Now decide." },
  { type: "text", text: '{"category": "Asked Price",' },
  { type: "text", text: ' "recommended_action": "Send pricing"}' },
], "Anthropic"), EXPECTED);

check("Anthropic (redacted_thinking is skipped)", normalize([
  { type: "redacted_thinking", data: "ENCRYPTED_BLOB_THAT_IS_NOT_JSON" },
  { type: "text", text: PAYLOAD },
], "Anthropic"), EXPECTED);

// A thinking block that itself contains JSON-looking prose is the nastiest
// case: if it were concatenated, extractJsonText would lock onto the WRONG
// object and the chain would return a confidently incorrect answer.
check("Anthropic (thinking contains decoy JSON)", normalize([
  { type: "thinking", thinking: 'Maybe {"category": "Not Interested"} — no, they asked price.' },
  { type: "text", text: PAYLOAD },
], "Anthropic"), EXPECTED);

// All-thinking, no text: must normalize to empty so the caller treats it as a
// provider failure rather than parsing garbage.
check("Anthropic (thinking only → empty)", flattenTextParts(
  [{ type: "thinking", thinking: "ran out of budget mid-reasoning" }], "Anthropic"
), "");

console.log("\n── extractJsonText hardening ──\n");

check("prose before and after", extractJsonText(`Here is the result:\n${PAYLOAD}\nHope that helps!`) , PAYLOAD);
check("brace inside a string value", JSON.parse(extractJsonText(
  '{"main_pain_point": "costs { rising } fast", "lead_score": 80}'
)), { main_pain_point: "costs { rising } fast", lead_score: 80 });
check("escaped quote inside value", JSON.parse(extractJsonText(
  '{"note": "they said \\"too expensive\\"", "lead_score": 42}'
)), { note: 'they said "too expensive"', lead_score: 42 });
check("leaked <thinking> tag stripped", JSON.parse(extractJsonText(
  `<thinking>I should answer {"category":"Stop"}</thinking>\n${PAYLOAD}`
)), EXPECTED);
check("unterminated <thinking> stripped", extractJsonText(
  `${PAYLOAD}\n<thinking>truncated mid-thought`
), PAYLOAD);
check("top-level array (cleanup shape)", JSON.parse(extractJsonText(
  '[{"business_name":"A"},{"business_name":"B"}]'
)), [{ business_name: "A" }, { business_name: "B" }]);
check("nested objects", JSON.parse(extractJsonText(
  '{"cleaned":[{"business_name":"A","meta":{"x":1}}],"dropped":[]}'
)), { cleaned: [{ business_name: "A", meta: { x: 1 } }], dropped: [] });
check("truncated mid-object → null", extractJsonText('{"category": "Asked Pri'), null);
check("no JSON at all → null", extractJsonText("I cannot help with that request."), null);
check("empty input → null", extractJsonText(""), null);

console.log("\n" + "─".repeat(60));
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\n  FAILURES:");
  for (const f of failures) {
    console.log(`    ${f.name}\n      expected: ${f.expected}\n      actual:   ${f.actual}`);
  }
}
console.log("");
process.exit(fail ? 1 : 0);
