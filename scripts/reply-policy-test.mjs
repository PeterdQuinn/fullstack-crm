#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".reply-policy-build");
fs.rmSync(out, { recursive: true, force: true });

execFileSync("npx", ["tsc", "lib/reply-policy.ts", "--outDir", out,
  "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  "--skipLibCheck"], { cwd: root, stdio: "inherit" });

const { bucketForCategory } = await import(`file://${path.join(out, "reply-policy.js")}`);
const cases = {
  Interested: "interested",
  "Asked Price": "interested",
  "Send Info": "interested",
  "Not Interested": "not_interested",
  Stop: "not_interested",
  "Wrong Person": "unclear",
  "Too Busy": "unclear",
  Question: "unclear",
  Unclear: "unclear",
};

let failed = 0;
for (const [category, expected] of Object.entries(cases)) {
  const actual = bucketForCategory(category);
  if (actual === expected) console.log(`  PASS  ${category} -> ${actual}`);
  else { failed++; console.error(`  FAIL  ${category}: expected ${expected}, got ${actual}`); }
}

fs.rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
