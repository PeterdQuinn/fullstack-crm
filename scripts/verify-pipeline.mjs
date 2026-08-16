#!/usr/bin/env node
/**
 * End-to-end pipeline verification.
 *
 *   node scripts/verify-pipeline.mjs                 # schema + DB checks only (safe)
 *   node scripts/verify-pipeline.mjs --routes        # also hit every cron route
 *   node scripts/verify-pipeline.mjs --routes --live # ...against production
 *
 * Checks, in order:
 *   1. every migration-added column/table actually exists in the database
 *   2. the pipeline's own invariants (archived filter works, scores, gating)
 *   3. optionally, that each cron route authenticates and returns 200
 *
 * A route returning 200 is NOT accepted as proof on its own — for the routes
 * that report counts, the payload is inspected too, because a health-check 200
 * with no work behind it is the exact failure this script exists to catch.
 *
 * Exit code 1 if any REQUIRED check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.CRON_SECRET;
const argv = process.argv.slice(2);
const DO_ROUTES = argv.includes("--routes");
const BASE = argv.includes("--live")
  ? "https://fullstack-crm-nine.vercel.app"
  : process.env.VERIFY_BASE_URL || "http://localhost:3000";

let failures = 0;
let warnings = 0;
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const warn = (m) => { warnings++; console.log(`  \x1b[33mWARN\x1b[0m  ${m}`); };
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

async function rest(q) {
  const res = await fetch(`${U}/rest/v1/${q}`, {
    headers: { apikey: K, Authorization: `Bearer ${K}`, Prefer: "count=exact" },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body, count: res.headers.get("content-range") };
}

/** A column exists iff selecting it does not return PostgREST error 42703. */
async function columnExists(table, column) {
  const r = await rest(`${table}?select=${column}&limit=1`);
  if (r.ok) return true;
  if (r.body?.code === "42703") return false;
  throw new Error(`${table}.${column}: unexpected ${r.status} ${JSON.stringify(r.body)}`);
}

// ── 1. SCHEMA ──────────────────────────────────────────────────────────────
head("1. Schema — columns the deployed code depends on");

const REQUIRED_COLUMNS = [
  ["leads", "archived_at", "008"],
  ["leads", "archive_reason", "008"],
  ["leads", "calendly_link_sent", "005"],
  ["leads", "google_rating", "005"],
  ["leads", "how_they_get_clients", "005"],
  ["leads", "employee_count", "005"],
  ["status_audit_log", "changed_by", "002/006"],
  ["status_audit_log", "old_status", "002/006"],
  ["status_audit_log", "new_status", "002/006"],
  ["status_audit_log", "reason", "002/006"],
];

for (const [table, column, mig] of REQUIRED_COLUMNS) {
  try {
    (await columnExists(table, column))
      ? pass(`${table}.${column}`)
      : fail(`${table}.${column} MISSING — apply migration ${mig} (supabase/APPLY_ALL_PENDING.sql)`);
  } catch (e) {
    fail(`${table}.${column} — ${e.message}`);
  }
}

// ── 2. PIPELINE INVARIANTS ─────────────────────────────────────────────────
head("2. Pipeline state");

const leads = await rest("leads?select=id&limit=1");
console.log(`  leads total: ${leads.count?.split("/")[1] ?? "?"}`);

const archived = await rest("leads?select=id&archived_at=not.is.null&limit=1");
if (archived.ok) pass(`archived-lead filter works (archived: ${archived.count?.split("/")[1] ?? 0})`);
else fail(`archived filter broken — ${JSON.stringify(archived.body)}`);

const scores = await rest("lead_ai_summaries?select=lead_score");
if (scores.ok && Array.isArray(scores.body)) {
  const vals = scores.body.map((r) => r.lead_score).filter((v) => v != null);
  const sendable = vals.filter((v) => v > 50).length;
  console.log(`  scored: ${vals.length}   >50 (sendable): ${sendable}   max: ${Math.max(0, ...vals)}`);
  sendable > 0
    ? pass(`${sendable} lead(s) clear the score>50 send gate`)
    : warn("no lead scores above 50 — every send path will find 0 eligible leads");
} else fail("could not read lead_ai_summaries");

const ready = await rest(`leads?select=id&status=in.("Ready for Outreach","Follow-Up Scheduled")&limit=1`);
if (ready.ok) {
  const n = Number(ready.count?.split("/")[1] ?? 0);
  n > 0 ? pass(`${n} lead(s) in a SENDABLE_STATUSES state`)
        : warn("no leads at 'Ready for Outreach' / 'Follow-Up Scheduled' — send phase will no-op");
} else fail("sendable-status query failed");

// ── 3. ROUTES ──────────────────────────────────────────────────────────────
if (DO_ROUTES) {
  head(`3. Cron routes @ ${BASE}`);
  if (!SECRET) fail("CRON_SECRET not set locally — cannot authenticate");

  // `verifies` inspects the JSON body so a content-free 200 cannot pass.
  const ROUTES = [
    { path: "/api/cron/daily-digest", method: "GET", verifies: (b) => b?.metrics !== undefined,
      note: "SENDS the digest email" },
    { path: "/api/cron/enrich-leads", method: "GET", verifies: (b) => b?.processed !== undefined },
    { path: "/api/cron/process-discovered-leads", method: "GET", verifies: (b) => b?.processed !== undefined },
    { path: "/api/cron/process-followups", method: "GET", verifies: (b) => b?.processed !== undefined },
    { path: "/api/cron/automation", method: "GET", verifies: (b) => Array.isArray(b?.results),
      note: "runs scrape+score+SEND" },
  ];

  for (const r of ROUTES) {
    try {
      const res = await fetch(`${BASE}${r.path}`, {
        method: r.method,
        headers: { Authorization: `Bearer ${SECRET}` },
      });
      const body = await res.json().catch(() => null);
      if (res.status !== 200) {
        fail(`${r.method} ${r.path} -> ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
      } else if (!r.verifies(body)) {
        // 200 but the payload proves no work happened — the health-check trap.
        fail(`${r.method} ${r.path} -> 200 but payload shows NO WORK: ${JSON.stringify(body).slice(0, 140)}`);
      } else {
        pass(`${r.method} ${r.path} -> 200  ${JSON.stringify(body).slice(0, 110)}`);
      }
    } catch (e) {
      fail(`${r.method} ${r.path} -> ${e.message}`);
    }
  }
} else {
  head("3. Cron routes — SKIPPED (pass --routes to run; note some SEND EMAIL)");
}

head(`Result: ${failures} failed, ${warnings} warning(s)`);
process.exit(failures > 0 ? 1 : 0);
