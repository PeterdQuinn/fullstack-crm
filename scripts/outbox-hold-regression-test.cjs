const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role";
process.env.RESEND_API_KEY = "synthetic-resend";
process.env.CRON_SECRET = "synthetic-cron";
process.env.OWNER_ALERT_EMAIL = "owner-test@example.invalid";
process.env.COMPANY_MAILING_ADDRESS = "123 Test St, Mesa, AZ 85201";

function loadTs(file, mocks) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => {
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
    throw new Error("Unexpected test import: " + name);
  };
  vm.runInNewContext(output, { exports, require: localRequire, process, console, setTimeout, clearTimeout, AbortController, fetch });
  return exports;
}

function outboxHarness(opts = {}) {
  const state = {
    row: opts.row ? { ...opts.row } : null,
    lead: opts.lead || { id: "lead-1", email: "shared@example.com", status: "Ready for Outreach", tenant_id: "tenant-a", opt_out: false, bounced: false, complained: false, archived_at: null },
    peers: opts.peers || [
      { id: "lead-1", email: "shared@example.com", tenant_id: "tenant-a", status: "Ready for Outreach", opt_out: false, bounced: false, complained: false },
    ],
    history: opts.history || [],
    peerTenantFilters: [],
    updates: [],
    upserts: 0,
    providerCalls: [],
    finalizeCalls: 0,
    claimCalls: 0,
  };
  const db = {
    from(table) {
      let fields = "";
      let filters = {};
      let updateValues = null;
      let inFilters = {};
      const q = {
        select(value) { fields = value || ""; return q; },
        eq(key, value) { filters[key] = value; return q; },
        ilike(key, value) { filters[key] = value; return q; },
        in(key, value) { inFilters[key] = value; return q; },
        limit() { return q; },
        order() { return q; },
        is(key, value) { filters[key] = value; return q; },
        upsert(value) {
          state.upserts++;
          if (!state.row) state.row = { id: "outbox-1", status: "pending", attempts: 0, ...value };
          return Promise.resolve({ error: null });
        },
        update(value) { updateValues = value; return q; },
        single() {
          if (table === "email_outbox") return Promise.resolve({ data: state.row, error: state.row ? null : { message: "missing" } });
          if (table === "leads") return Promise.resolve({ data: state.lead, error: state.lead ? null : { message: "missing" } });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() { return q.single(); },
        then(resolve, reject) {
          let result;
          if (table === "leads" && updateValues) {
            result = { error: null };
          } else if (table === "email_outbox" && updateValues) {
            state.updates.push({ ...updateValues });
            if (opts.updateError) result = { error: { message: opts.updateError } };
            else { state.row = { ...state.row, ...updateValues }; result = { error: null }; }
          } else if (table === "leads" && filters.tenant_id && Object.prototype.hasOwnProperty.call(filters, "email")) {
            const tenant = filters.tenant_id;
            state.peerTenantFilters.push(tenant);
            result = { data: state.peers.filter((p) => p.tenant_id === tenant), error: null };
          } else if (table === "outreach_log") {
            result = { data: state.history, error: null };
          } else if (table === "email_outbox") {
            const statuses = inFilters.status || [];
            const rows = state.row && statuses.includes(state.row.status) && state.row.finalized_at == null ? [state.row] : [];
            result = { data: rows, error: null };
          } else {
            result = { data: [], error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return q;
    },
    rpc(name) {
      if (name === "finalize_email_outbox") { state.finalizeCalls++; return Promise.resolve({ error: null }); }
      if (name === "claim_email_outbox") {
        state.claimCalls++;
        if (opts.claimEmpty) return Promise.resolve({ data: [], error: null });
        state.row = { ...state.row, status: "sending" };
        return Promise.resolve({ data: [{ ...state.row }], error: null });
      }
      throw new Error("Unexpected test RPC: " + name);
    },
  };
  class FakeResend {
    constructor() { this.emails = { send: async (payload, options) => {
      state.providerCalls.push({ payload, options });
      if (opts.providerError) throw new Error(opts.providerError);
      return { data: { id: "provider-message-1" }, error: null };
    } }; }
  }
  const identity = loadTs("lib/outreach-identity.ts", {});
  const outbox = loadTs("lib/email-outbox.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "resend": { Resend: FakeResend },
    "node:crypto": require("node:crypto"),
    "@/lib/outreach-identity": identity,
    "@/lib/email-templates": { sendBlockedReason: () => null },
  });
  return { state, db, identity, outbox };
}

function automationHarness({ leads, sendEmail }) {
  const db = {
    from(table) {
      let countQuery = false;
      const q = {
        select(_fields, options) { countQuery = Boolean(options && options.head); return q; },
        eq() { return q; }, neq() { return q; }, not() { return q; }, is() { return q; },
        in() { return q; }, gte() { return q; }, lt() { return q; }, limit() { return q; }, order() { return q; },
        single() { return Promise.resolve({ data: { niches: ["HVAC"] }, error: null }); },
        then(resolve, reject) {
          const result = table === "outreach_log" && countQuery
            ? { count: 0, error: null }
            : table === "leads" ? { data: leads, error: null }
            : { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const identity = loadTs("lib/outreach-identity.ts", {});
  const errorModule = loadTs("lib/email-outbox.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "resend": { Resend: class {} },
    "node:crypto": require("node:crypto"),
    "@/lib/outreach-identity": identity,
    "@/lib/email-templates": { sendBlockedReason: () => null },
  });
  const automation = loadTs("lib/automation.ts", {
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/ai-scoring": { scoreLead: async () => ({}) },
    "@/lib/acquisition-qualification": { hasSourcedOperationalNeed: () => true },
    "@/lib/resend": { sendEmail },
    "@/lib/email-outbox": errorModule,
    "@/lib/email-templates": {
      sendBlockedReason: () => null,
      renderOutreachEmail: () => ({ subject: "Test", html: "<p>Test</p>", bodyText: "Test" }),
    },
    "@/lib/outreach-markets": { marketApproved: () => true },
    "@/lib/email-sequence": { nextFollowUpAt: () => new Date().toISOString() },
    "@/lib/audit": { logStatusChange: async () => {} },
    "@/lib/lead-stats": { phoenixDayStartIso: () => "2026-11-22T07:00:00.000Z" },
    "@/lib/email-validation": { checkMailability: async (email) => ({ ok: true, email }) },
    "@/lib/internet-intelligence": { verifiedOutreachDetail: () => undefined },
    "@/lib/score-thresholds": {
      FALLBACK_SCORE: 50, SCORE_KEEP_THRESHOLD: 20, SCORE_SEND_THRESHOLD: 20,
      scoreAllowsSend: (score) => score >= 20 && score !== 50,
    },
  });
  return { automation, errorModule };
}

(async () => {
  const lead = { id: "11111111-1111-4111-8111-111111111111", business_name: "Test HVAC", email: "shared@example.com", city: "Mesa", state: "AZ", status: "Ready for Outreach", email_sent_count: 0, industry: "HVAC", lead_ai_summaries: [{ lead_score: 80 }], lead_internet_observations: [] };
  const key = "crm-" + lead.id + "-email-1";

  // Existing exact duplicate hold is terminal until an owner explicitly resolves it.
  const held = outboxHarness({ row: { id: "outbox-held", idempotency_key: key, lead_id: lead.id, message_type: "email_1", recipient: lead.email, status: "needs_review", error_message: "Duplicate CRM mailbox requires owner review" } });
  for (let n = 0; n < 2; n++) {
    await assert.rejects(held.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key), (err) => err.name === "PersistedEmailReviewHoldError");
  }
  assert.equal(held.state.providerCalls.length, 0);
  assert.equal(held.state.updates.length, 0);
  assert.equal(held.state.peerTenantFilters.length, 0);
  const unknownHold = outboxHarness({ row: { id: "outbox-unknown", idempotency_key: key, lead_id: lead.id, message_type: "email_1", recipient: lead.email, status: "needs_review", error_message: "Unconfirmed send exceeded safe retry window" } });
  await assert.rejects(unknownHold.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key),
    (err) => err.name !== "PersistedEmailReviewHoldError");
  assert.equal(unknownHold.state.providerCalls.length, 0, "unclassified review states remain blocked and are not skips");
  const recoveredHeld = await held.outbox.recoverEmailOutbox();
  assert.deepEqual({ recovered: recoveredHeld.recovered, deferred: recoveredHeld.deferred, errors: recoveredHeld.errors.length }, { recovered: 0, deferred: 0, errors: 0 });

  // A new duplicate is held only after the hold write succeeds; cross-tenant peers are excluded.
  const duplicate = outboxHarness({ lead: { ...held.state.lead, id: lead.id }, peers: [
    { id: "one", email: lead.email, tenant_id: "tenant-a", opt_out: false },
    { id: "two", email: lead.email, tenant_id: "tenant-a", opt_out: false },
    { id: "foreign", email: lead.email, tenant_id: "tenant-b", opt_out: false },
  ] });
  await assert.rejects(duplicate.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key), (err) => err.name === "PersistedEmailReviewHoldError");
  assert.equal(duplicate.state.row.status, "needs_review");
  assert.equal(duplicate.state.row.error_message, "Duplicate CRM mailbox requires owner review");
  assert.deepEqual(duplicate.state.peerTenantFilters, ["tenant-a"]);
  assert.equal(duplicate.state.providerCalls.length, 0);

  const failedHoldWrite = outboxHarness({ peers: [
    { id: "one", email: lead.email, tenant_id: "tenant-a", opt_out: false },
    { id: "two", email: lead.email, tenant_id: "tenant-a", opt_out: false },
  ], updateError: "write denied" });
  await assert.rejects(failedHoldWrite.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key), /Could not persist mailbox review hold/);
  assert.equal(failedHoldWrite.state.providerCalls.length, 0);

  // Known ineligible recipient is persisted as cancelled and can be skipped thereafter.
  const cancelled = outboxHarness({ lead: { ...held.state.lead, opt_out: true } });
  await assert.rejects(cancelled.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key), (err) => err.name === "PersistedEmailCancelledError");
  assert.equal(cancelled.state.row.status, "cancelled");
  await assert.rejects(cancelled.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key),
    (err) => err.name === "PersistedEmailCancelledError");
  assert.equal(cancelled.state.providerCalls.length, 0);

  // Cross-tenant same-mailbox record cannot create a same-tenant duplicate hold.
  const foreignOnly = outboxHarness({ peers: [
    { id: "one", email: lead.email, tenant_id: "tenant-a", opt_out: false },
    { id: "foreign", email: lead.email, tenant_id: "tenant-b", opt_out: false },
  ], claimEmpty: true });
  await assert.rejects(foreignOnly.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, key),
    (err) => !(err instanceof foreignOnly.outbox.PersistedEmailReviewHoldError));
  assert.deepEqual(foreignOnly.state.peerTenantFilters, ["tenant-a"]);
  assert.equal(foreignOnly.state.providerCalls.length, 0);

  // Suppression, replies and previous touches remain blocked.
  const identity = foreignOnly.identity;
  assert.match(identity.mailboxSendBlock(lead.email, "email_1", [{ id: "x", email: lead.email, tenant_id: "tenant-a", opt_out: true }], []), /suppressed/i);
  assert.match(identity.mailboxSendBlock(lead.email, "email_2", [{ id: "x", email: lead.email, tenant_id: "tenant-a" }], [{ direction: "inbound" }]), /replied/i);
  assert.match(identity.mailboxSendBlock(lead.email, "email_1", [{ id: "x", email: lead.email, tenant_id: "tenant-a" }], [{ direction: "outbound", message_type: "email_1", provider_message_id: "existing" }]), /already received/i);

  // Exact successful delivery idempotency prevents duplicate provider calls.
  const successful = outboxHarness();
  const successfulKey = key;
  const first = await successful.outbox.sendSavedEmail(lead.email, "subject", "body", undefined, successfulKey);
  const second = await successful.outbox.sendSavedEmail(lead.email, "changed subject", "changed body", undefined, successfulKey);
  assert.equal(first.id, "provider-message-1");
  assert.equal(second.id, "provider-message-1");
  assert.equal(successful.state.providerCalls.length, 1);

  // Provider failures are fatal in the send phase; persisted review/cancel errors alone are skips.
  const cancelledLead = { ...lead, id: "22222222-2222-4222-8222-222222222222", business_name: "Cancelled HVAC", email: "cancelled@example.com" };
  const nextLead = { ...lead, id: "33333333-3333-4333-8333-333333333333", business_name: "Next HVAC", email: "next@example.com" };
  const leads = [lead, cancelledLead, nextLead];
  const sentCalls = [];
  const { automation: sendAutomation, errorModule } = automationHarness({ leads, sendEmail: async (_email, _subject, _html, _reply, idempotencyKey) => {
    sentCalls.push(idempotencyKey);
    if (idempotencyKey === "crm-" + lead.id + "-email-1") throw new errorModule.PersistedEmailReviewHoldError(idempotencyKey, "Duplicate CRM mailbox requires owner review");
    if (idempotencyKey === "crm-" + cancelledLead.id + "-email-1") throw new errorModule.PersistedEmailCancelledError(idempotencyKey);
    return { id: "delivered-test" };
  } });
  const sendResult = await sendAutomation.runAutomationPhase("send");
  assert.equal(sendResult.sent, 1);
  assert.equal(sendResult.skipped, 2);
  assert.equal(sendResult.heldForReview, 1);
  assert.equal(sentCalls.length, 3, "review-held and cancelled leads did not stop the next eligible recipient");

  const { automation: providerFailureAutomation } = automationHarness({ leads: [lead], sendEmail: async () => { throw new Error("Resend provider unavailable"); } });
  await assert.rejects(providerFailureAutomation.runAutomationPhase("send"), /Resend provider unavailable/);

  const { automation: persistenceFailureAutomation } = automationHarness({ leads: [lead], sendEmail: async () => { throw new Error("Could not persist mailbox review hold"); } });
  await assert.rejects(persistenceFailureAutomation.runAutomationPhase("send"), /Could not persist mailbox review hold/);

  // The cron's genuine send-phase failure still records and sends an owner alert.
  const alerts = [];
  const route = loadTs("app/api/cron/automation/route.ts", {
    "../../../../lib/cron-auth": { cronAuthError: () => null },
    "@/lib/automation-runs": { withAutomationRun: async (_stage, _req, run) => run() },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options && options.status || 200, ok: (options && options.status || 200) < 400 }) } },
    "@supabase/supabase-js": { createClient: () => ({ from: () => ({ insert: async (row) => { alerts.push({ table: "cron_failures", row }); return { error: null }; } }) }) },
    "@/lib/automation": { runAutomationPhase: async () => { throw new Error("Resend provider unavailable"); } },
    "@/lib/email-outbox": { recoverEmailOutbox: async () => ({ recovered: 0, deferred: 0, errors: [] }) },
    "@/lib/resend": { sendEmail: async (_to, subject) => { alerts.push({ table: "owner_alert", subject }); return { id: "test-alert" }; } },
  });
  const response = await route.GET({ headers: { get: () => "Bearer synthetic-cron" } });
  assert.equal(response.status, 500);
  assert.equal(alerts.filter((a) => a.table === "cron_failures").length, 1);
  assert.equal(alerts.filter((a) => a.table === "owner_alert").length, 1);

  console.log("PASS persisted review holds, cancellation skips, continued eligible sends, idempotency, tenant scoping, suppression/reply safeguards, persistence failures, and real failure alert path");
})().catch((error) => { console.error(error); process.exit(1); });
