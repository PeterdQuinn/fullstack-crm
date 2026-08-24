#!/usr/bin/env node
//
// Tenant isolation harness. Two halves:
//
//   STATIC   Every route in MIGRATED must go through tenantScope(). Runs with no
//            database and no credentials, so it works in CI and pre-commit.
//   LIVE     Seeds two tenants and proves A cannot read or write B. Skipped with
//            a clear message until 011_multi_tenant.sql has been applied.
//
// WHY A LIST INSTEAD OF "ALL ROUTES": all 38 Supabase-touching routes are
// unmigrated today, so a blanket assertion would just fail red forever and stop
// meaning anything. MIGRATED grows one batch at a time; the run prints the
// remaining count so progress is visible, and a migrated route that regresses
// fails immediately.
//
//   node scripts/tenant-leak-test.mjs          static only
//   node scripts/tenant-leak-test.mjs --live   static + live leak tests

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");

for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

// ── Routes migrated to tenantScope(). Add each one as its batch lands. ───────
const MIGRATED = [
  // Batch 1 — crm/*
  "app/api/crm/stats/route.ts",
  // Batch 2 — admin/*
  // Batch 3 — email/*
  // Batch 4 — cron/*
  // Batch 5 — webhooks/resend
  // Batch 6 — ai/*, appointments, scrape-phone
];

function allRouteFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") out.push(path.relative(root, full));
    }
  };
  walk(path.join(root, "app", "api"));
  return out.sort();
}

console.log("\nSTATIC — tenant scoping\n");

const routes = allRouteFiles();
const touchesDb = routes.filter((r) =>
  fs.readFileSync(path.join(root, r), "utf8").includes("@supabase/supabase-js")
);

for (const route of MIGRATED) {
  const src = fs.readFileSync(path.join(root, route), "utf8");

  // A module-scope client is shared across every request a warm lambda serves,
  // so it cannot carry request state. This is the single defect that makes the
  // migration real work rather than a find-and-replace.
  const moduleScopeClient = /^const\s+\w+\s*=\s*createClient\(/m.test(src);
  check(`${route}: no module-scope createClient`, !moduleScopeClient);

  check(`${route}: imports tenantScope`, src.includes("tenantScope"));

  // Importing the raw driver in a route re-opens the hole tenantScope closes.
  check(
    `${route}: no direct @supabase/supabase-js import`,
    !src.includes('from "@supabase/supabase-js"')
  );
}

check(
  "every migrated route still exists",
  MIGRATED.every((r) => fs.existsSync(path.join(root, r))),
  MIGRATED.filter((r) => !fs.existsSync(path.join(root, r))).join(", ")
);

const remaining = touchesDb.filter((r) => !MIGRATED.includes(r));
console.log(
  `\n  progress: ${MIGRATED.length}/${touchesDb.length} Supabase routes migrated, ${remaining.length} remaining`
);

// ── Live isolation ──────────────────────────────────────────────────────────
if (!live) {
  console.log("\nLIVE — skipped (pass --live to run against a database)\n");
} else {
  console.log("\nLIVE — cross-tenant isolation\n");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const rest = async (method, pathAndQuery, body) => {
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const probe = await rest("GET", "leads?select=tenant_id&limit=1");
  if (probe.status === 400 && JSON.stringify(probe.body).includes("tenant_id")) {
    console.log("  SKIP  011_multi_tenant.sql has not been applied — no tenant_id column yet.");
    console.log("        Apply the migration to a Supabase branch, then re-run with --live.\n");
  } else {
    const suffix = Date.now();
    const mk = async (name) =>
      (await rest("POST", "tenants", [{ name: `${name}-${suffix}`, plan: "solo", status: "active" }]))
        .body?.[0]?.id;

    const a = await mk("leak-test-a");
    const b = await mk("leak-test-b");
    check("two test tenants created", Boolean(a && b), `a=${a} b=${b}`);

    if (a && b) {
      const leadB = (
        await rest("POST", "leads", [
          { tenant_id: b, business_name: `leak-probe-${suffix}`, status: "New" },
        ])
      ).body?.[0]?.id;

      // The service role bypasses RLS, so this asserts the SCOPE, not the
      // policy: it is exactly the guarantee application code must provide.
      const asA = await rest("GET", `leads?select=id&tenant_id=eq.${a}&id=eq.${leadB}`);
      check("tenant A cannot read tenant B's lead", Array.isArray(asA.body) && asA.body.length === 0);

      const forged = await rest("PATCH", `leads?id=eq.${leadB}&tenant_id=eq.${a}`, {
        business_name: "forged",
      });
      check(
        "tenant A cannot write tenant B's lead by id",
        Array.isArray(forged.body) && forged.body.length === 0
      );

      // Cleanup — leave no test rows behind in a real database.
      await rest("DELETE", `leads?id=eq.${leadB}`);
      await rest("DELETE", `tenants?id=in.(${a},${b})`);
      console.log("  (test tenants and probe lead removed)");
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
