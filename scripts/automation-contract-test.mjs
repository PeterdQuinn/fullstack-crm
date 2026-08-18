#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".automation-contract-build");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const line of read(".env.local").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const i = trimmed.indexOf("=");
  process.env[trimmed.slice(0, i).trim()] ||= trimmed.slice(i + 1).trim();
}

fs.rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["tsc", "lib/email-validation.ts", "lib/email-templates.ts", "lib/lead-stats.ts",
  "--outDir", out, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  "--skipLibCheck"], { cwd: root, stdio: "inherit" });

const emailValidation = await import(`file://${path.join(out, "email-validation.js")}`);
const emailTemplates = await import(`file://${path.join(out, "email-templates.js")}`);
const leadStats = await import(`file://${path.join(out, "lead-stats.js")}`);

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}`); }
}

check("valid prospect email accepted", emailValidation.looksLikeRealEmail("owner@hvaccompany.com"));
for (const bad of ["logo@2x.png", "no-reply@example.com", "a@sentry.io", "x@gmail.com%20"]) {
  check(`bad email rejected: ${bad}`, !emailValidation.looksLikeRealEmail(bad));
}

check("physical mailing address configured", emailTemplates.sendBlockedReason() === null);
const rendered = emailTemplates.renderOutreachEmail({
  leadId: "contract-test-lead",
  businessName: "Example HVAC",
  ownerName: "<script>alert(1)</script>",
  emailSentCount: 0,
});
check("outreach includes unsubscribe URL", rendered.html.includes("/api/email/unsubscribe?lead_id="));
check("recipient name is HTML escaped", !rendered.html.includes("<script>"));

const stats = leadStats.computeLeadDashboardStats([
  { status: "Call Needed", phone: "6025550100" },
  { status: "Booked", meeting_booked: true },
  { status: "Onboarding Sent", meeting_booked: true },
  { status: "Onboarding Completed", meeting_booked: true },
]);
check("opened/call-priority lead counted", stats.callQueue === 1);
check("completed onboarding excluded from pending queue", stats.onboarding === 2);

const vercel = JSON.parse(read("vercel.json"));
const schedules = new Map(vercel.crons.map((cron) => [cron.path, cron.schedule]));
for (const route of ["/api/cron/discover-leads", "/api/cron/automation", "/api/cron/process-followups",
  "/api/cron/poll-replies", "/api/cron/daily-digest"]) {
  check(`scheduled: ${route}`, schedules.has(route));
}

for (const file of ["lib/automation.ts", "lib/reply-actions.ts", "app/api/cron/process-followups/route.ts",
  "app/api/cron/send-daily-emails/route.ts", "app/api/email/send-daily/route.ts", "app/api/email/send-batch/route.ts"]) {
  check(`idempotency key used: ${file}`, read(file).includes("`crm-${lead.id}-"));
}

check("reply polling fails when mailbox config is missing", read("app/api/cron/poll-replies/route.ts").includes("{ status: 503 }"));
check("cron reports partial phase failures", read("app/api/cron/automation/route.ts").includes("failedPhases.length === 0 ? 200 : 500"));
check("follow-up cron reports per-task failures", read("app/api/cron/process-followups/route.ts").includes("results.errors.length === 0 ? 200 : 500"));

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
