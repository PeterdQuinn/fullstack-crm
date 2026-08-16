#!/usr/bin/env node
/**
 * Bulk lead scorer — clears the whole backlog in one run.
 *
 *   node scripts/batch-score.mjs --dry-run          # score 5, write nothing
 *   node scripts/batch-score.mjs --limit=50
 *   node scripts/batch-score.mjs                    # everything unscored
 *   node scripts/batch-score.mjs --concurrency=8
 *
 * WHY THIS EXISTS
 *
 * The serverless scoring phase (lib/automation.ts) is capped at SCORE_BATCH=3
 * because a Vercel function must finish in 60s. That is a deployment-shape
 * limit, not a real one: scoring is a plain async call against the same provider
 * chain. Run outside serverless — locally, or in a GitHub Actions runner with a
 * 6-hour budget — the same work goes as wide as the providers tolerate.
 *
 * Measured: ~8s per lead serially. 341 leads = ~45 min serial, ~9 min at
 * concurrency 5.
 *
 * SAFETY
 *   - Never deletes. Leads that fail the completeness gate are ARCHIVED
 *     (archived_at/archive_reason), exactly like lib/automation.ts.
 *   - A "fallback" score (every provider down) is discarded, never persisted —
 *     the lead is left untouched and retried on the next run.
 *   - --dry-run performs the real AI calls but writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── env ─────────────────────────────────────────────────────────────────────
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
};
const DRY = process.argv.includes("--dry-run");
const LIMIT = Number(arg("limit", DRY ? 5 : 0)) || 0;
const CONCURRENCY = Math.max(1, Math.min(Number(arg("concurrency", 5)), 12));
const KEEP_THRESHOLD = Number(arg("threshold", 50));

// ── compile the REAL scoring lib, so this tests shipping code ───────────────
const OUT = path.join(ROOT, ".batch-score-build");
const TSCONFIG = path.join(ROOT, ".batch-score-tsconfig.json");
fs.writeFileSync(
  TSCONFIG,
  JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "esnext", moduleResolution: "bundler",
      skipLibCheck: true, esModuleInterop: true, outDir: ".batch-score-build",
      baseUrl: ".", paths: { "@/*": ["./*"] },
    },
    files: ["lib/ai-providers.ts", "lib/ai-scoring.ts"],
  })
);
fs.rmSync(OUT, { recursive: true, force: true });
try {
  execFileSync("npx", ["tsc", "-p", TSCONFIG], { cwd: ROOT, stdio: "inherit" });
} finally {
  fs.rmSync(TSCONFIG, { force: true });
}
for (const f of fs.readdirSync(OUT)) {
  if (!f.endsWith(".js")) continue;
  const p = path.join(OUT, f);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/from "@\/lib\/([a-z-]+)"/g, 'from "./$1.js"'));
}
fs.writeFileSync(path.join(OUT, "package.json"), '{"type":"module"}');
const { scoreLead } = await import(path.join(OUT, "ai-scoring.js"));

// ── data access (PostgREST directly — no supabase-js needed here) ───────────
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const rest = async (q, init) => {
  const res = await fetch(`${U}/rest/v1/${q}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

console.log(`\nBulk scorer — concurrency=${CONCURRENCY} threshold=${KEEP_THRESHOLD}${DRY ? "  [DRY RUN]" : ""}`);

// Anti-join: pull scored ids, then take unscored, non-archived leads.
const scoredRows = await rest("lead_ai_summaries?select=lead_id");
const scored = new Set(scoredRows.map((r) => r.lead_id));

let pool;
try {
  pool = await rest("leads?select=id,business_name,email,phone&archived_at=is.null&order=created_at.asc");
} catch (e) {
  if (String(e).includes("archived_at")) {
    console.error("\n✗ leads.archived_at does not exist — run supabase/APPLY_ALL_PENDING.sql first.\n");
    process.exit(1);
  }
  throw e;
}

let queue = pool.filter((l) => !scored.has(l.id));
if (LIMIT) queue = queue.slice(0, LIMIT);

console.log(`${pool.length} active leads, ${scored.size} already scored → ${queue.length} to process\n`);
if (queue.length === 0) { console.log("Nothing to do."); process.exit(0); }

const stats = { scored: 0, kept: 0, archived: 0, fallback: 0, errors: 0 };
const started = Date.now();
let done = 0;

async function processLead(lead) {
  const n = ++done;
  const tag = `[${String(n).padStart(4)}/${queue.length}] ${(lead.business_name || "?").slice(0, 38).padEnd(38)}`;
  try {
    // Completeness gate — mirrors REQUIRED_FIELDS in lib/automation.ts.
    const missing = ["business_name", "email", "phone"].filter((f) => isBlank(lead[f]));
    if (missing.length) {
      stats.archived++;
      if (!DRY) {
        await rest(`leads?id=eq.${lead.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            archived_at: new Date().toISOString(),
            archive_reason: `incomplete: missing ${missing.join(", ")}`,
          }),
        });
      }
      console.log(`${tag} ARCHIVED (missing ${missing.join(",")})`);
      return;
    }

    const res = await scoreLead({ id: lead.id, business_name: lead.business_name });

    if ((res.provider || "fallback") === "fallback") {
      // Every provider failed — not a real judgment. Leave the lead alone.
      stats.fallback++;
      console.log(`${tag} SKIPPED (all providers down)`);
      return;
    }

    const score = res.lead_score ?? 0;
    stats.scored++;

    if (!DRY) {
      await rest("lead_ai_summaries", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          lead_id: lead.id,
          main_pain_point: res.main_pain_point,
          best_attack_angle: res.best_attack_angle,
          recommended_first_message: res.recommended_first_message,
          recommended_follow_up: res.recommended_follow_up,
          lead_score: score,
          confidence_level: res.confidence_level,
          missing_data_needed: res.missing_data_needed,
        }),
      });
    }

    if (score >= KEEP_THRESHOLD) {
      stats.kept++;
      if (!DRY) {
        await rest(`leads?id=eq.${lead.id}&status=in.("New","Scored")`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "Ready for Outreach" }),
        });
      }
      console.log(`${tag} ${String(score).padStart(3)}  ✓ ready  (${res.provider})`);
    } else {
      if (!DRY) {
        await rest(`leads?id=eq.${lead.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            archived_at: new Date().toISOString(),
            archive_reason: `below threshold: scored ${score} < ${KEEP_THRESHOLD}`,
          }),
        });
      }
      stats.archived++;
      console.log(`${tag} ${String(score).padStart(3)}  archived (${res.provider})`);
    }
  } catch (err) {
    stats.errors++;
    console.log(`${tag} ERROR ${err.message?.slice(0, 90)}`);
  }
}

// Simple fixed-size worker pool.
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const lead = queue.shift();
    if (lead) await processLead(lead);
  }
});
await Promise.all(workers);

const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\n──────── done in ${mins} min ────────`);
console.log(`  scored:            ${stats.scored}`);
console.log(`  kept (>=${KEEP_THRESHOLD}):       ${stats.kept}`);
console.log(`  archived:          ${stats.archived}`);
console.log(`  skipped/fallback:  ${stats.fallback}`);
console.log(`  errors:            ${stats.errors}`);
if (DRY) console.log("\n[DRY RUN] nothing was written.\n");
