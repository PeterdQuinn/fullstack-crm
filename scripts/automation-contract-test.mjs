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
execFileSync("npx", ["tsc", "lib/email-validation.ts", "lib/email-templates.ts", "lib/email-sequence.ts", "lib/lead-stats.ts", "lib/research-evidence.ts",
  "--outDir", out, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  "--skipLibCheck"], { cwd: root, stdio: "inherit" });

const emailValidation = await import(`file://${path.join(out, "email-validation.js")}`);
const emailTemplates = await import(`file://${path.join(out, "email-templates.js")}`);
const emailSequence = await import(`file://${path.join(out, "email-sequence.js")}`);
const leadStats = await import(`file://${path.join(out, "lead-stats.js")}`);
const researchEvidence = await import(`file://${path.join(out, "research-evidence.js")}`);

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
const edited = emailTemplates.renderEditedOutreachEmail({
  leadId: "edited-message",
  emailNum: 1,
  subject: "My approved subject",
  messageText: "My approved message\n\n<script>alert(1)</script>",
});
check("edited email preserves approved subject and message", edited.subject === "My approved subject" && edited.bodyText.includes("My approved message"));
check("edited email protects HTML and compliance footer", !edited.html.includes("<script>") && edited.bodyText.includes(emailTemplates.COMPANY_MAILING_ADDRESS) && edited.bodyText.includes("/api/email/unsubscribe?lead_id="));
const ownershipFollowup = emailTemplates.renderOutreachEmail({
  leadId: "service-wizard",
  businessName: "Service Wizard",
  ownerName: "Sam",
  emailSentCount: 1,
  followUp: "recommended_follow_up",
});
check("followup uses the honest software ownership message", ownershipFollowup.bodyText.includes("should be a business asset") && ownershipFollowup.bodyText.includes("own the tool they depend on"));
check("outbound copy contains no unsupported case study claim", [0, 1, 2].every(emailSentCount => {
  const message = emailTemplates.renderOutreachEmail({ leadId: "claim-check", businessName: "Example HVAC", emailSentCount });
  return !/Austin|35%|case study/i.test(message.bodyText);
}));
check("followup includes the configured postal address", ownershipFollowup.bodyText.includes(emailTemplates.COMPANY_MAILING_ADDRESS));
check("every message identifies Peter Quinn as owner", [0, 1, 2].every(emailSentCount => {
  const message = emailTemplates.renderOutreachEmail({ leadId: "identity-check", businessName: "Example HVAC", emailSentCount });
  return message.bodyText.includes("Peter Quinn") && message.bodyText.includes("Owner, Full Stack Services LLC") && message.bodyText.includes("fullstackservicesllc.net");
}));
check("followup is independent of AI draft text", !ownershipFollowup.bodyText.includes("recommended_follow_up"));
const dueFrom = new Date("2026-08-18T16:00:00.000Z");
check("followup waits exactly three days", emailSequence.nextFollowUpAt(dueFrom) === "2026-08-21T16:00:00.000Z");
check("manual Email Workspace allows 100 sends", emailSequence.MANUAL_SEND_CAP === 100);
const evidenceFacts = researchEvidence.buildResearchFacts({ address: "Mesa, AZ", city: "Mesa", state: "AZ", industry: "Landscaping", technologies: "Shopify" });
check("research address removes duplicate city values", researchEvidence.cleanResearchAddress({ address: "Mesa, AZ", city: "Mesa", state: "AZ" }) === "Mesa, AZ");
check("website technology is not labeled operating software", evidenceFacts.find(f => f.field_name === "website_technologies")?.label === "Website technology" && evidenceFacts.find(f => f.field_name === "current_software")?.certainty === "not_found");
check("single source research is not labeled verified", evidenceFacts.find(f => f.field_name === "industry")?.certainty === "single_source");

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
check("followup processing is daily after reply polling", workflow.includes('cron: "30 15 * * *"'));
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
const emailWorkspace = read("app/crm/email-queue/page.tsx");
const emailQueueRoute = read("app/api/email/queue/route.ts");
const emailQueueAction = read("app/api/email/queue-action/route.ts");
check("email workspace sends only the selected lead", emailWorkspace.includes("leadId: selected.id") && emailWorkspace.includes("/api/email/send-batch"));
check("email workspace has focused responsive tabs", emailWorkspace.includes('type Tab = "message" | "research" | "history"') && emailWorkspace.includes("lg:grid-cols"));
check("email workspace shows manual send capacity", emailQueueRoute.includes("MANUAL_SEND_CAP") && emailQueueRoute.includes("remaining"));
check("email workspace actions are allowlisted", emailQueueAction.includes("ACTIONS.includes") && emailQueueAction.includes("do_not_contact"));
const researchCenter = read("app/crm/dm-queue/page.tsx");
const researchRoute = read("app/api/crm/research-center/route.ts");
const discoveryPipeline = read("lib/discovery-pipeline.ts");
check("Research Center never contacts a lead", !researchCenter.includes("send-batch") && !researchCenter.includes("mark-dm-sent"));
check("manual discovery has a hard result limit", discoveryPipeline.includes("Math.min(Number(options.limit) || 10, 25)"));
check("manual discovery supports location and quality rules", researchCenter.includes("minimumRating") && researchCenter.includes("minimumReviews") && researchCenter.includes("requireWebsite"));
check("manual discovery applies an exact radius when coordinates resolve", discoveryPipeline.includes("geocodeSearchArea") && discoveryPipeline.includes("radiusMeters"));
check("selected AI research remains manual", researchCenter.includes("Run AI Research") && researchRoute.includes('action === "research"'));
check("research transfers are explicit", researchRoute.includes('action === "approve_email"') && researchRoute.includes('action === "move_calls"'));
check("research findings preserve source review", researchCenter.includes("Open every source") && researchRoute.includes("sourceCandidates") && researchRoute.includes("new Map"));
check("research facts use explicit certainty levels", researchCenter.includes("Single source") && researchCenter.includes("AI inference") && researchCenter.includes("Not found"));
check("low confidence research requires review", researchRoute.includes("Low confidence research must be checked") && researchCenter.includes("researchReviewed"));
check("research evidence migration exists", read("supabase/migrations/010_research_evidence.sql").includes("lead_research_facts"));
const unsubscribeRoute = read("app/api/email/unsubscribe/route.ts");
const workspaceRoute = read("app/api/crm/workspace/route.ts");
check("unsubscribe cancels pending outreach", unsubscribeRoute.includes('from("follow_up_tasks")') && unsubscribeRoute.includes('status: "cancelled"'));
check("suppressed leads cannot be restored through general edits", workspaceRoute.includes("Restore requires a dedicated reviewed action"));
check("suppressed leads cannot receive booking replies", read("lib/reply-actions.ts").includes('action: "suppressed_no_contact"'));
check("suppressed leads cannot be logged as calls", read("app/api/crm/log-call/route.ts").includes("suppressed and cannot be contacted"));

const selectedSendRoute = read("app/api/email/send-batch/route.ts");
check("lead Email tab requires a selected lead", selectedSendRoute.includes('const leadId = typeof body.leadId') && selectedSendRoute.includes('.eq("id", leadId)'));
check("legacy endpoint cannot silently bulk send", selectedSendRoute.includes("bulk sending is not available"));
check("selected-lead send uses manual daily cap", selectedSendRoute.includes("MANUAL_SEND_CAP") && selectedSendRoute.includes("phoenixDayStartIso"));
check("manual followup send closes its pending task", selectedSendRoute.includes("Sent manually from Email Workspace") && selectedSendRoute.includes('task_type", `send_email_${emailNum}`'));
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
