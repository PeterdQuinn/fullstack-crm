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
const workflow = read(".github/workflows/cron.yml");
check("Vercel-native crons disabled", !Object.hasOwn(vercel, "crons"));
for (const route of ["discover-leads", "enrich-leads", "process-discovered-leads", "automation",
  "process-followups", "poll-replies", "daily-digest"]) {
  check(`GitHub schedule maps: ${route}`, workflow.includes(`routes=${route}`));
}
check("reply polling is daily", workflow.includes('cron: "30 14 * * *"'));
check("heavy automation is Monday-only", workflow.includes('cron: "0 13 * * 1"') && workflow.includes('cron: "0 19 * * 1"'));

for (const file of ["lib/automation.ts", "lib/reply-actions.ts", "app/api/cron/process-followups/route.ts",
  "app/api/email/send-batch/route.ts"]) {
  check(`idempotency key used: ${file}`, read(file).includes("`crm-${lead.id}-"));
}

for (const file of ["app/api/cron/send-daily-emails/route.ts", "app/api/email/send-daily/route.ts",
  "app/api/email/bulk-ready/route.ts"]) {
  check(`legacy route disabled: ${file}`, read(file).includes("{ status: 410 }"));
}

const leadsPage = read("app/crm/leads/page.tsx");
check("Leads workspace has no browser Supabase client", !leadsPage.includes("@/lib/supabase") && !leadsPage.includes("supabase.from"));
check("anonymous database policies are removed", read("supabase/migrations/009_lock_down_anon.sql").includes('drop policy if exists "Allow all on leads"'));
const repliesPage = read("app/crm/replies/page.tsx");
const repliesRoute = read("app/api/crm/replies/route.ts");
check("processed replies cannot be classified twice", repliesPage.includes("!reply.action_completed") && repliesRoute.includes("action_completed"));
check("reply errors show the server detail", repliesPage.includes("data?.automationError"));
const callQueuePage = read("app/crm/call-queue/page.tsx");
const logCallRoute = read("app/api/crm/log-call/route.ts");
check("call workspace includes full lead preparation", callQueuePage.includes("Call Preparation") && callQueuePage.includes("Recent Calls") && callQueuePage.includes("Lead Notes"));
check("call outcome controls lead status", logCallRoute.includes("OUTCOME_STATUS") && logCallRoute.includes("next_follow_up_at"));
check("call workspace removes visible status hyphens", callQueuePage.includes('value.replaceAll("-", " ")'));

const selectedSendRoute = read("app/api/email/send-batch/route.ts");
check("lead Email tab requires a selected lead", selectedSendRoute.includes('const leadId = typeof body.leadId') && selectedSendRoute.includes('.eq("id", leadId)'));
check("legacy endpoint cannot silently bulk send", selectedSendRoute.includes("bulk sending is not available"));
check("selected-lead send uses shared daily cap", selectedSendRoute.includes("DAILY_SEND_CAP") && selectedSendRoute.includes("phoenixDayStartIso"));
check("selected-lead send rejects unsafe statuses", selectedSendRoute.includes('["Ready for Outreach", "Email 1 Sent", "Email 2 Sent", "Follow-Up Scheduled"]'));
check("selected-lead send is HVAC-only", selectedSendRoute.includes('market !== "hvac"'));
check("manual queue excludes New leads", !read("app/api/email/queue/route.ts").includes('        "New",'));

check("reply polling fails when mailbox config is missing", read("app/api/cron/poll-replies/route.ts").includes("{ status: 503 }"));
check(
  "stored replies resume unfinished processing",
  read("app/api/cron/poll-replies/route.ts").includes("const stored = await storedReply(msg.id)") &&
    read("app/api/cron/poll-replies/route.ts").includes("await markReplyProcessed(msg.id)")
);
check("reply polling includes already-read messages", read("lib/graph-inbox.ts").includes("fetchRecentInbox") && !read("lib/graph-inbox.ts").includes("$filter=isRead eq false"));
check("processed replies are not acted on twice", read("app/api/cron/poll-replies/route.ts").includes('stored?.status === "processed"'));
check("failed mark-read can retry independently", read("app/api/cron/poll-replies/route.ts").includes("retryMarkRead"));
check(
  "Graph mark-read failures are surfaced",
  read("lib/graph-inbox.ts").includes("if (!res.ok)") &&
    read("lib/graph-inbox.ts").includes("Graph mark-read failed")
);
check("cron reports partial phase failures", read("app/api/cron/automation/route.ts").includes("failedPhases.length === 0 ? 200 : 500"));
check("follow-up cron reports per-task failures", read("app/api/cron/process-followups/route.ts").includes("results.errors.length === 0 ? 200 : 500"));
const followupRoute = read("app/api/cron/process-followups/route.ts");
check("follow-ups share the daily send cap", followupRoute.includes("DAILY_SEND_CAP") && followupRoute.includes("remainingToday"));
check("follow-ups reject unsafe addresses", followupRoute.includes("rejectionReason(lead.email)"));
check("follow-ups reject stale tasks", followupRoute.includes("Skipped stale task"));
check("follow-ups reject non-sequence statuses", followupRoute.includes("followUpStatuses.has(lead.status)"));

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
