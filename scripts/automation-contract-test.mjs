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

// Compile through a real tsconfig rather than bare CLI flags. Two reasons, both
// of which have already broken this test:
//   - `@/lib/...` imports need the project's path alias. research-evidence.ts
//     started importing @/lib/hvac-signals and the flag-only build could not
//     resolve it, so `npm test` failed on a file that compiles fine in the app.
//   - without `strict`, discriminated unions in lib/ do not narrow, so this
//     harness reported type errors the real build does not have.
// Matching tsconfig.json here means the test checks the code as it actually
// ships instead of a weaker dialect of it.
const tsconfigPath = path.join(root, ".automation-contract-tsconfig.json");
fs.writeFileSync(
  tsconfigPath,
  JSON.stringify(
    {
      compilerOptions: {
        outDir: out,
        module: "esnext",
        target: "es2022",
        moduleResolution: "bundler",
        skipLibCheck: true,
        strict: true,
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
      },
      files: [
        "lib/email-validation.ts",
        "lib/email-templates.ts",
        "lib/email-sequence.ts",
        "lib/lead-stats.ts",
        "lib/research-evidence.ts",
        "lib/internet-intelligence.ts",
        // Imported by research-evidence.ts; must be emitted or the rewrite
        // below would point at a file that does not exist.
        "lib/hvac-signals.ts",
      ],
    },
    null,
    2
  )
);
try {
  execFileSync("npx", ["tsc", "--project", tsconfigPath], { cwd: root, stdio: "inherit" });
} finally {
  fs.rmSync(tsconfigPath, { force: true });
}

// tsc type-checks path aliases but does not rewrite them in the emitted JS, so
// `import ... from "@/lib/hvac-signals"` survives into the output and Node's ESM
// loader treats it as a bare package name. Rewrite aliases to relative
// specifiers (and add the .js extension Node requires) so the modules below can
// actually be imported.
for (const file of fs.readdirSync(out).filter((f) => f.endsWith(".js"))) {
  const target = path.join(out, file);
  const src = fs.readFileSync(target, "utf8");
  const rewritten = src.replace(
    /(\bfrom\s*["'])@\/lib\/([^"']+)(["'])/g,
    (_m, head, mod, tail) => `${head}./${mod}.js${tail}`
  );
  if (rewritten !== src) fs.writeFileSync(target, rewritten);
}

const emailValidation = await import(`file://${path.join(out, "email-validation.js")}`);
const emailTemplates = await import(`file://${path.join(out, "email-templates.js")}`);
const emailSequence = await import(`file://${path.join(out, "email-sequence.js")}`);
const leadStats = await import(`file://${path.join(out, "lead-stats.js")}`);
const researchEvidence = await import(`file://${path.join(out, "research-evidence.js")}`);
const internetIntelligence = await import(`file://${path.join(out, "internet-intelligence.js")}`);

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
check("followup uses the honest software ownership message", ownershipFollowup.bodyText.includes("what you pay every month") && ownershipFollowup.bodyText.includes("own none of it at the end"));
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
const internetScores = internetIntelligence.scoreInternetIntelligence([
  { category: "hiring", signal: "Now hiring technicians", value: "Three openings", sourceLabel: "Careers", sourceUrl: "https://example.com/careers", observedAt: new Date().toISOString(), confidence: "high", growthDirection: 1 },
  { category: "expansion", signal: "New location", value: "Opened a second branch", sourceLabel: "News", sourceUrl: "https://example.com/news", observedAt: new Date().toISOString(), confidence: "medium", growthDirection: 1 },
], { business_name: "Example HVAC", website: "example.com", google_review_count: 250, technologies: "CallRail" });
check("internet intelligence separates footprint from growth", internetScores.footprintScore > 0 && internetScores.momentumScore >= 25 && internetScores.momentumLabel === "growing");
const matchedIdentity = internetIntelligence.identityMatch(
  { business_name: "Example HVAC", website: "examplehvac.com", city: "Mesa", state: "AZ", phone: "602-555-0199" },
  { title: "Example HVAC", description: "Serving Mesa AZ. Call 602-555-0199", url: "https://www.bbb.org/example-hvac" },
);
const rejectedIdentity = internetIntelligence.identityMatch(
  { business_name: "Example HVAC", city: "Mesa", state: "AZ" },
  { title: "Example Plumbing", description: "A company in Boston MA", url: "https://example.org" },
);
check("internet research accepts matched companies and rejects namesakes", matchedIdentity.accepted && matchedIdentity.score >= 40 && !rejectedIdentity.accepted);
const corroborated = internetIntelligence.corroborateObservations([
  { category: "hiring", signal: "Hiring activity", value: "Hiring technicians", sourceLabel: "Careers", sourceUrl: "https://example.com/careers", observedAt: new Date().toISOString(), confidence: "medium", growthDirection: 1 },
  { category: "hiring", signal: "Hiring activity", value: "Technician openings", sourceLabel: "Jobs", sourceUrl: "https://jobs.example.org/example", observedAt: new Date().toISOString(), confidence: "medium", growthDirection: 1 },
]);
check("two independent sources corroborate an internet fact", corroborated.every(item => item.evidenceType === "verified" && item.corroborationCount === 2));
const groundedEmail = emailTemplates.renderOutreachEmail({ leadId: "grounded", businessName: "Example HVAC", emailSentCount: 0, verifiedDetail: "The company is hiring three technicians." });
// Regex sentence-matching cannot produce an outreach-grade fact, so the detail
// selector returns nothing and every caller falls back to the generic opener.
// The renderer keeps working with a supplied detail so flipping the flag back
// on once real extraction exists needs no template change.
check("keyword-matched observations are never offered to outreach", (() => {
  const wellFormed = internetIntelligence.corroborateObservations([
    { category: "expansion", signal: "Expansion activity", value: "They opened a second location in Mesa to serve the east valley.", sourceLabel: "News", sourceUrl: "https://news.example.com/a", observedAt: new Date().toISOString(), confidence: "high", growthDirection: 1 },
    { category: "expansion", signal: "Expansion activity", value: "They opened a second location in Mesa to serve the east valley.", sourceLabel: "Blog", sourceUrl: "https://blog.example.org/b", observedAt: new Date().toISOString(), confidence: "high", growthDirection: 1 },
  ]);
  return wellFormed.every((o) => o.evidenceType === "verified") &&
    internetIntelligence.verifiedOutreachDetail(wellFormed) === undefined;
})());
const factExtraction = await import(`file://${path.join(out, "fact-extraction.js")}`);
check("an LLM-extracted fact is offered to outreach", (() => {
  const fact = "Example HVAC is hiring two service technicians for its Mesa location.";
  return internetIntelligence.verifiedOutreachDetail([
    { category: "hiring", signal: factExtraction.OUTREACH_FACT_SIGNAL, value: fact,
      sourceLabel: "Verified by Gemini", sourceUrl: "https://example.com/careers",
      observedAt: new Date().toISOString(), confidence: "high", growthDirection: 1 },
  ]) === fact;
})());
check("extraction rejects boilerplate, slogans and unnamed facts", (() => {
  const name = "Indoor Comfort Supply";
  const junk = [
    "Here are some links to leave us recommendations and reviews.",
    "We handle each job with the same level of expertise and care every time.",
    "Indoor Comfort Supply - 99 Reviews - Retail in Phoenix, AZ - Birdeye",
    "They opened a second location in Mesa to serve the east valley this spring.",
  ];
  const good = "Indoor Comfort Supply opened a second location in Mesa this spring.";
  return junk.every((v) => !factExtraction.factLooksUsable(v, name)) && factExtraction.factLooksUsable(good, name);
})());
check("extraction has its own provider chain including Kablewy",
  read("lib/ai-providers.ts").includes("EXTRACTION_PROVIDERS") && read("lib/ai-providers.ts").includes('defaults: ["Gemini", "Ollama", "Groq", "Kablewy", "Anthropic", "Kimi"]'));
check("extraction is allowed to answer none",
  read("lib/fact-extraction.ts").includes('{"fact": null}') && read("lib/fact-extraction.ts").includes("Returning null is the correct answer"));
check("the renderer still supports a detail once extraction is real",
  groundedEmail.bodyText.includes("Noticed this about"));
// The Firecrawl pipeline shipped callable only from the manual research page,
// so lead_internet_observations stayed empty through 352 sends and every
// automated email used the generic opener. A scheduled caller must exist.
check("verified means two independent sources, not one confident scrape",
  read("lib/internet-intelligence.ts").includes('evidenceType: count >= 2 ? "verified" : "single_source"'));
check("only a complete sentence can be pasted into outreach", (() => {
  const junk = ["REMOVEDcame out and did an excellent job on couple of neglected issues",
    "SKILLED HVAC PROFESSIONALS YOU CAN TRUST IN YOUR HOME We understand th",
    "Whether it is a minor adjustment to get your system running smoothly or"];
  const good = "They opened a second location in Mesa to serve the east valley this spring.";
  return junk.every((v) => !internetIntelligence.usableOutreachDetail(v)) && internetIntelligence.usableOutreachDetail(good);
})());
// Supply, not the send cap, was the binding constraint: 9 enrichment attempts
// a day against 126 leads holding a website but no email address.
const enrichLib = read("lib/enrich.ts");
check("enrichment works a real batch, not three leads a day",
  enrichLib.includes("enrichLeadsBatch(batchSize = 12") &&
  read("app/api/cron/enrich-leads/route.ts").includes("Number(body.batchSize) || 12"));
check("a bigger enrichment batch cannot outrun the route budget",
  enrichLib.includes("deadlineMs = 45_000") && enrichLib.includes("Date.now() - startedAt > deadlineMs"));
// Measured: enrichment plus research in one route finished at 137s against a
// 120s ceiling, because a deadline only stops another lead being *started*.
check("research is its own stage, not a passenger on enrichment",
  read("app/api/cron/research-leads/route.ts").includes("researchLeadsBatch") &&
  !read("app/api/cron/enrich-leads/route.ts").includes("researchLeadsBatch"));
check("one slow lead cannot consume the research route",
  read("lib/lead-research.ts").includes("PER_LEAD_TIMEOUT_MS = 70_000") &&
  read("lib/lead-research.ts").includes("Promise.race"));
// A second lead may only start while 70s of work still fits under the ceiling.
check("the research cutoff leaves room for the lead it starts",
  read("lib/lead-research.ts").includes("deadlineMs = 45_000"));
check("scheduled discovery asks for a full batch",
  read("app/api/cron/discover-leads/route.ts").includes("limit: 25"));
check("status reports what is mailable, not just what is qualified",
  read("app/api/admin/status/route.ts").includes("mailableNow") &&
  read("app/api/admin/status/route.ts").includes("readyAwaitingEmail"));

// Unattended only works if a broken run reaches a human the same day.
const digest = read("app/api/cron/daily-digest/route.ts");
check("the digest reads automation run health", digest.includes('from("automation_runs")') && digest.includes("failedRuns"));
check("a run that died mid-execution is treated as a failure", digest.includes('r.status === "running"') && digest.includes("stalledRuns"));
check("a failing pipeline changes the subject line", digest.includes("CRM ALERT"));
check("silence with mailable leads is itself an alert",
  digest.includes("mailableNow") && digest.includes("nothing sent with"));
check("a broken pipeline is never reported as a quiet day",
  digest.includes("d.quiet && !healthBanner"));
// middleware.ts exempts /api/cron, so an unguarded verb on any cron route is
// world-callable. research-leads shipped with an unauthenticated POST that also
// bypassed the pause gate; this sweeps every route so it cannot happen again.
for (const dir of fs.readdirSync("app/api/cron", { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const route = read(`app/api/cron/${dir.name}/route.ts`);
  if (!route.includes("export async function POST")) continue;
  const guarded = route.includes("CRON_SECRET") && route.includes("Unauthorized");
  check(`cron POST requires the secret: ${dir.name}`, guarded);
}
check("internet research runs on a schedule, not only by hand",
  read("app/api/cron/research-leads/route.ts").includes("researchLeadsBatch") &&
  read(".github/workflows/cron.yml").includes("routes=research-leads"));
check("automated research saves observations and intelligence",
  read("lib/lead-research.ts").includes('from("lead_internet_observations").insert') &&
  read("lib/lead-research.ts").includes('from("lead_internet_intelligence").upsert'));
check("a missing Firecrawl key fails the run loudly",
  read("lib/lead-research.ts").includes("isFirecrawlConfigured()") &&
  read("lib/lead-research.ts").includes("no internet evidence can be gathered"));
check("research only spends credits on mailable leads",
  read("lib/lead-research.ts").includes('.not("email", "is", null)') &&
  read("lib/lead-research.ts").includes("RESEARCHABLE"));
check("Firecrawl supports deployment and key rotation env names", read("lib/internet-intelligence.ts").includes("FIRECRAWL_API_KEY") && read("lib/internet-intelligence.ts").includes("FIRE_CRAWL_API_KEY") && read("lib/internet-intelligence.ts").includes("FIRECRAWL_API_KEYS"));
check("internet observations are dated and append-only", read("supabase/migrations/014_internet_intelligence.sql").includes("observed_at") && !read("supabase/migrations/014_internet_intelligence.sql").includes("unique(lead_id"));

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
for (const route of ["discover-leads", "enrich-leads", "research-leads", "process-discovered-leads", "automation",
  "process-followups", "poll-replies", "daily-digest"]) {
  check(`GitHub schedule maps: ${route}`, workflow.includes(`routes=${route}`));
}
check("reply polling is daily", workflow.includes('cron: "30 14-23 * * *"'));
check("followup processing is daily after reply polling", workflow.includes('cron: "35 14-23 * * *"'));
check("daily discovery and three daily send passes", workflow.includes('cron: "0 13 * * *"') && workflow.includes('cron: "0 16,19,22 * * *"'));

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
// The discovery controls moved out of dm-queue into their own component; this
// check followed the behaviour, not the old file path.
const discoveryPanel = read("app/crm/_components/ManualDiscoveryPanel.tsx");
check("manual discovery supports location and quality rules", discoveryPanel.includes("minimumRating") && discoveryPanel.includes("minimumReviews") && discoveryPanel.includes("requireWebsite"));
check("manual discovery applies an exact radius when coordinates resolve", discoveryPipeline.includes("geocodeSearchArea") && discoveryPipeline.includes("radiusMeters"));
// Overpass 429/502/503/504 are "busy, come back", not "no results". Every public
// mirror returned 502/504 simultaneously on 2026-08-24 and a single shot per
// mirror threw the whole OSM half of discovery away.
const discoverySources = read("lib/discovery-sources.ts");
check("Overpass retries a busy mirror", discoverySources.includes("BACKOFF_MS") && discoverySources.includes("TRANSIENT"));
check("Overpass retries are bounded by a wall-clock budget", discoverySources.includes("TOTAL_BUDGET_MS"));
check("a busy Overpass reports as temporary, not broken", discoverySources.includes("busy on every mirror right now"));
check("Overpass still degrades to empty rather than throwing", discoverySources.includes("return [];"));
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
check("manual followup send closes its pending task", read("supabase/migrations/016_autonomous_outreach.sql").includes("task_type='send_' || item.message_type"));
check("selected-lead send rejects unsafe statuses", selectedSendRoute.includes('["Ready for Outreach", "Email 1 Sent", "Email 2 Sent", "Follow-Up Scheduled"]'));
// Was 'market !== "hvac"'. The outreach copy stopped naming a trade in 11a356d,
// so the gate became an allowlist in lib/outreach-markets.ts. What must hold is
// that a gate still exists and still fails closed — not that it names one trade.
const outreachMarkets = read("lib/outreach-markets.ts");
check("selected-lead send is restricted to approved markets", selectedSendRoute.includes("marketRejectionReason"));
check("named niches support optional configured market restrictions", outreachMarkets.includes("APPROVED_MARKETS.includes"));
check("a lead with no market is never mailed", outreachMarkets.includes("Boolean(market) &&"));
// The page counted six hardcoded terminal statuses, so it rendered 31 of 386
// leads: four sat at zero, "Dead" was absent, and the 169 in Ready for Outreach
// were invisible. It also drew the same numbers twice, as a bar block and then
// a table block directly beneath it.
const reportsApi = read("app/api/crm/reports/route.ts");
const reportsPage = read("app/crm/reports/page.tsx");
check("reports counts every status present in the data",
  reportsApi.includes("counts.set(status") && reportsApi.includes("!STAGE_ORDER.includes(s)"));
check("reports surfaces send performance, not just outcomes",
  reportsApi.includes("opened_at") && reportsApi.includes("replied_at") && reportsApi.includes("rates"));
check("reports states each number once",
  !reportsPage.includes("Table (same numbers, precise)") &&
  // The render site only. data.pipeline.map also appears computing the max,
  // which is arithmetic, not a second copy of the numbers on screen.
  reportsPage.split("data.pipeline.map((s) => (").length === 2);
check("reports uses the shared status colors",
  reportsPage.includes("getStatusStyle") && !reportsPage.includes("const BAR_COLOR"));
// A bounce kills an address, not a business. 24 leads sat at "Bad Email" with a
// phone on file and no opt-out or complaint, in no work queue at all.
const suppression = read("lib/suppression.ts");
const callQueue = read("app/api/crm/call-queue/route.ts");
check("suppression distinguishes a request to stop from a dead address",
  suppression.includes("isPermanentlySuppressed") && suppression.includes("isEmailSuppressed"));
check("only an opt-out or complaint blocks every channel",
  suppression.includes("Boolean(lead.opt_out) || Boolean(lead.complained)") &&
  suppression.includes('lead.status === EMAIL_FAILURE_STATUS'));
check("a bad address does not hide a working phone number",
  callQueue.includes("EMAIL_FAILURE_STATUS") && callQueue.includes('.eq("complained", false)'));
check("suppressed list catches addresses rejected before any send",
  read("app/api/crm/suppressed/route.ts").includes("status.eq.${EMAIL_FAILURE_STATUS}"));
check("manual queue excludes New leads", !read("app/api/email/queue/route.ts").includes('        "New",'));

// 57% of the list is a role inbox, so the reply that matters is the one least
// likely to come back from the address we mailed. Exact-address matching alone
// files an owner's personal reply as "no lead matches" and loses it.
const pollRoute = read("app/api/cron/poll-replies/route.ts");
check("reply matching falls back beyond the exact address",
  pollRoute.includes("findLeadForReply") && pollRoute.includes('matchedBy: "thread"') && pollRoute.includes('matchedBy: "domain"'));
check("a shared mail provider is never treated as identity",
  pollRoute.includes("PUBLIC_MAILBOX_DOMAINS") && pollRoute.includes('"gmail.com"') &&
  pollRoute.includes("!PUBLIC_MAILBOX_DOMAINS.has(domain)"));
check("an ambiguous domain or thread match is refused",
  pollRoute.includes("byDomain?.length === 1") && pollRoute.includes("leadIds.length === 1"));
check("Re:/Fwd: prefixes are stripped before thread matching",
  pollRoute.includes("normalizeSubject") && pollRoute.includes("(?:re|fw|fwd)"));
check("how a reply matched is recorded for audit", pollRoute.includes("matched by ${matchedBy}"));
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
check("follow-ups reject unsafe addresses", followupRoute.includes("checkMailability(lead.email)"));
// A send Resend never delivered must not get a follow-up stacked on top of it.
check("follow-ups skip an undelivered previous touch", followupRoute.includes("previous email was never confirmed delivered"));
check("follow-ups skip after a provider failure", followupRoute.includes('lastTouch.status === "failed"'));
const resendWebhook = read("app/api/webhooks/resend/route.ts");
check("webhook handles a failed/suppressed send", resendWebhook.includes('case "email.failed"'));
// A re-run of the daily digest must not 500 and fail the cron workflow.
const digestRoute = read("app/api/cron/daily-digest/route.ts");
check("daily digest tolerates a repeat run", digestRoute.includes("alreadySent"));
check("daily digest only swallows idempotency errors", digestRoute.includes("if (!/idempotency key/i.test(message)) throw sendError;"));
check("suppressed send suppresses the lead", resendWebhook.includes("Failed-send suppression failed"));
// Terminal vs transient: "Bad Email" is a one-way door, so a rate limit or
// provider blip must never send a live prospect through it.
check("retryable provider failure does not condemn the lead", resendWebhook.includes("failed_retryable"));
// A DNS timeout must not be recorded as a dead prospect: "Bad Email" is
// terminal and nothing ever retries it.
check("follow-ups defer on transient DNS failure", followupRoute.includes("mailability.transient"));
check("selected-lead send defers on transient DNS failure", selectedSendRoute.includes("mailability.transient"));
check("follow-ups reject stale tasks", followupRoute.includes("Skipped stale task"));
check("follow-ups reject non-sequence statuses", followupRoute.includes("followUpStatuses.has(lead.status)"));

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
