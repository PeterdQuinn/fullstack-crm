# SaaS Conversion — Goal & TODO

> **Read this first.** Brief for whoever picks this up, including a fresh AI agent.
> Last verified: 2026-08-24. Branch `saas-multi-tenant`, rebased onto `main` @ `e94fa83`.

## What this app is

An **AI-driven cold-outreach CRM**, converting from single-operator tool to
**multi-tenant SaaS**.

```
DISCOVER → ENRICH → RESEARCH → [APPROVE: human gate] → OUTREACH → REPLIES → CLOSE
```

## The goal

Each customer connects **their own AI provider and keys**.

| Plan | Setup (one time) | Monthly | Annual (two months free) |
|---|---|---|---|
| Solo | $1,000 | $600/mo | $6,000/yr |
| Company | $3,000 | $1,000/mo | $10,000/yr |

Solo: 1 login, 1 niche, 1 inbox. Company: 5 logins, multiple niches/territories,
several inboxes, shared pipeline, priority support. The setup fee pays for wiring
their AI into their network + generating niche config from a questionnaire.

## Non-negotiable guardrails

1. **Tenant isolation.** One cross-tenant leak kills the business.
2. **Never hardcode our AI keys into a tenant's runtime.** Fail loudly instead.
3. **Keep evidence-grading discipline.** Negatives claim only "not found on pages
   read." Thin page → unknown, never a fabricated gap.
4. **Suppression is global per tenant.**
5. **Bring-your-own-inbox.** No shared sending infrastructure.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase/Postgres · Vercel.
AI layer is `lib/ai-providers.ts` (per-provider keys, task-specific chains).

## How the work gets done

Peter directs and approves; the agent implements. Work top to bottom. Verify with
real calls before reporting done. Do not apply migrations or deploy unasked.

---

## DONE

- [x] Landing page with full pricing
- [x] Login + session auth — `lib/session.ts`, `app/api/auth/*`, middleware gate.
      **Shipped to production** 2026-08-23 (`04e3df9`), verified 7/7 against prod.
- [x] HVAC research intelligence
- [x] Outreach market gate widened to an allowlist (`lib/outreach-markets.ts`).
      Four separate gates were pinned to HVAC — send-batch, automation, the
      workspace queue, and the Send button. Sendable queue went **1 → 24**.
- [x] Scraped-address repair + transient-DNS deferral (`lib/email-validation.ts`);
      5 wrongly-condemned leads requeued, `Bad Email` 27 → 22
- [x] Test harness repaired — compiled with no path alias and no strict mode, so
      it had been failing since 2026-08-20. `npm test` 88/0.
- [x] Tenant schema written — `supabase/migrations/011_multi_tenant.sql` (**not applied**)
- [x] `lib/tenant.ts` — `tenantScope()`, `tenantSecrets()`, `reserveUsage()`, `PLAN_LIMITS`
- [x] **Route survey complete** — findings in step 2 below
- [x] **Phase 0 complete** (2026-08-23) — branch rebased onto `main`; env parity
      audited; dead Kablewy provider dropped from the chains
- [x] **Batch 0 complete** (2026-08-23) — see step 2

---

## Phase 0 — housekeeping ✅

- [x] Rebase `saas-multi-tenant` onto `main`. The branch carried the *old*
      Supabase login that `main` has since replaced; the 5 overlapping files were
      byte-identical so the rebase was clean.
- [x] Audit `.env.local` vs Vercel production. **They had diverged both ways.**
- [x] Drop Kablewy from all chains — `api.kablewy.com` is NXDOMAIN, permanently dead.
- [ ] **Add `OWNER_ALERT_EMAIL` to Vercel production.** It is read by
      `app/api/cron/automation/route.ts` but **not set in prod**, so cron failure
      alerts have never sent. Silent failures. One `vercel env add` away.
- [ ] Mirror the Kablewy removal in the Vercel `*_PROVIDERS` vars
- [ ] Decide on Kimi (429 quota) and Anthropic (no credit) — restore or remove

### Env divergence found

| Variable | Local | Prod | Note |
|---|---|---|---|
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_MAILBOX` | ✗ | ✓ | Reply polling works in prod; absent locally |
| `GROQ_API_KEY` | as `Groq_API_KEY` | ✓ | Code reads both cases — untidy, not broken |
| `COHERE` / `MISTRAL` / `CEREBRAS` / `TOGETHER` / `HF` | ✗ | ✓ | Prod-only, unused by current chains |
| `OWNER_ALERT_EMAIL` | ✓ | **✗** | **Failure alerts dead in prod** |
| `KABLEWY_*`, `Kimi_API_KEY`, `GEMINI_MODEL` | ✓ | ✗ | Local-only |

---

## Phase 1 — tenant isolation ← the big one

### 1. Apply the tenant migration

**Decision (2026-08-23): Supabase branch first, never straight at prod.**

- [x] **APPLIED 2026-08-24** via the Supabase dashboard SQL editor (project ref
      `opqzcdukaaoejrvtzdum`). Verified from the outside, not taken on trust.
- [x] Verified: routes touch 10 tables, migration covers 12. **No gaps.**
- [x] Backfill verified: **2,552 rows across 12 tables, zero orphans**
      (leads 368, lead_socials 687, status_audit_log 339, lead_ai_summaries 315,
      lead_research_facts 294, outreach_log 295, follow_up_tasks 208, call_logs 32,
      lead_notes 9, lead_discovery_config 5, appointments 0, cron_failures 0)
- [x] `NOT NULL` enforced — insert without `tenant_id` returns `23502`, no row created
- [x] Founding tenant `a9a24e70-13bc-4f0d-b5db-d74e36e18be1` "Full Stack Services",
      `is_founding = true`, company/active
- [x] RLS on and live isolation green — `npm run test:tenant:live` 4/4
- [x] **Production unaffected**: app reads via service role (bypasses RLS) and no
      component uses the anon key, so the CRM behaved identically. Queue verified
      at 23 leads after the migration.
- [x] **`012_tenant_id_default.sql` — APPLIED, urgent fix.** 011 made `tenant_id`
      NOT NULL and *every* INSERT in the app omits it, so all writes failed with
      23502. Reads were fine (service role bypasses RLS) which is why the first
      verification missed it. Worst case was `outreach_log`: Resend accepts the
      mail, then the log insert throws — prospect mailed, no CRM record, cap
      counter lost, no follow-up. `012` defaults `tenant_id` to the founding
      tenant. **Temporary** — drop the defaults after Batches 1–6 (DROP block is
      in the file), or a route that forgets its tenant writes silently.
- [x] **`013_atomic_reserve_usage.sql` written** — `reserve_usage()` /
      `release_usage()` as a single `UPDATE ... WHERE used < cap`. `reserveUsage`
      now calls the RPC and falls back to the old racy path only if 013 is not
      applied (42883). **NOT YET APPLIED — run it.**
- [ ] Spot-check `current_tenant_id()` returns the right tenant for a test user
- [ ] Generated Supabase types — `tenantScope()` widens the query builder to
      `any` because a non-literal table name kills inference. Generated types
      would restore it and catch column typos across all 37 routes.

### 2. Batch 0 — foundations ✅

- [x] `.upsert()` added to `tenantScope()` (7 calls in 5 files needed it)
- [x] **`update()` hardened** — it did not strip a caller-supplied `tenant_id`, so
      a request body echoed into a patch could move a row into another tenant.
      The `.eq("tenant_id")` filter does not catch this: it selects which rows
      change, not what they become.
- [x] `requireTenant(req)` + `founderTenant()` + `assertTenantActive()`
- [x] `lib/tenant-token.ts` — HMAC-signed tenant tokens for the session-less
      routes (**decision: signed token, not payload lookup**). No expiry by
      design: CAN-SPAM requires unsubscribe links to keep working.
- [x] `scripts/tenant-leak-test.mjs` + `npm run test:tenant` / `test:tenant:live`
- [x] Wired into `npm test`
- [ ] ~~ESLint rule~~ — **deviation:** the repo has no ESLint setup and adding one
      is new tooling. The equivalent guard lives in the leak-test harness, which
      already asserts no module-scope `createClient` and no direct
      `@supabase/supabase-js` import in any migrated route.

### 3. Migrate the API routes to `tenantScope()`

| Fact | Value |
|---|---|
| Routes total / touching Supabase | 52 / 38 |
| Shared query helper | **None** — 38 identical hand-rolled imports |
| **Built at module scope (col 0)** | **38 / 38** |
| Built inside a handler | **0** |
| `.rpc()` calls | **0** — nothing escapes the wrapper |

**The module-scope client is the real blocker.** `const supabase = createClient(...)`
at file top-level is built once per warm lambda and shared across requests from
different tenants. No request context exists at construction time, so it cannot be
tenant-scoped where it sits. All 38 must move inside the handler. Not a find-and-replace.

Add each route to `MIGRATED` in `scripts/tenant-leak-test.mjs` as it lands; the
harness prints remaining count and fails on regression.

- [x] **Batch 1 reference implementation** — `app/api/crm/stats/route.ts`.
      Exposed two defects that would have shipped across all 38: `serviceClient()`
      had no no-store fetch (Next caches supabase-js's internal fetch, so
      migrating would have silently reintroduced the stale-counts bug), and
      `select()` dropped its options argument, losing `{ count: "exact" }`.
- [ ] **Batch 1** — `crm/*` — 15 routes left, 18 writes — tenant from session
- [ ] **Batch 2** — `admin/*` — 11 routes, 3 writes — session + role check
- [ ] **Batch 3** — `email/*` — 8 routes, 9 writes — signed token for tracking/unsubscribe
- [ ] **Batch 4** — `cron/*` — 8 routes, 17 writes — loop per tenant
- [ ] **Batch 5** — `webhooks/resend` — 1 route, 8 writes — signed token in payload
- [ ] **Batch 6** — `ai/*`, `appointments`, `scrape-phone` — 5 routes — session

### 4. Cross-tenant leak tests

Run `npm run test:tenant:live` after every batch. Red = stop, do not start the next.

- [ ] Two tenants seeded with data in each
- [ ] Tenant A cannot read B's leads, summaries, facts, replies, bookings
- [ ] Tenant A cannot write into B by forging a `tenant_id` in a payload
- [ ] Unauthenticated request gets nothing
- [ ] Cron scoped to A never touches B

---

## Phase 2 — getting paid

### 5. Stripe billing

- [ ] `npm i stripe`
- [ ] Prices: Solo $600/mo + $1,000 setup, Company $1,000/mo + $3,000 setup
- [ ] Annual: Solo $6,000/yr, Company $10,000/yr
- [ ] Checkout charging setup fee + first subscription payment in one flow
- [ ] Monthly vs annual-upfront toggle
- [ ] Webhook `checkout.session.completed` → `setup_fee_paid`, `status = active`
- [ ] `past_due` / `cancelled` → gate access on `tenants.status`
      (`assertTenantActive()` already exists for this)
- [ ] Setup fee one-time, non-refundable

### 6. Signup + onboarding

- [ ] `app/signup` — creates tenant + `tenant_members`, then Stripe Checkout
- [ ] Apply `PLAN_LIMITS` from chosen plan
- [ ] Niche questionnaire: ICP, niche, territories, differentiators, offer
- [ ] Generate `tenant_configs.generated_config` from answers
- [ ] Connect AI keys → `tenant_secrets` (kind `ai_provider`)
- [ ] Connect inbox + calendar → `tenant_secrets` (kind `inbox` / `calendar`)

---

## Phase 3 — actually multi-tenant in behaviour

### 7. Bring-your-own-AI wiring

- [ ] `lib/ai-providers.ts` reads keys from `tenantSecrets()`, not `process.env`
- [ ] Never fall back to our keys — fail loudly. A silent fallback puts our API
      bill on their usage.
- [ ] Per-tenant provider chain order in `tenant_configs`

### 8. Auth cutover

- [ ] Supabase Auth signup/login for tenant customers
- [x] Existing `APP_USERNAME` / `APP_PASSWORD` session login kept working
- [ ] Decide whether Basic Auth stays as founder-only back door
- [ ] Gate `/crm/*` on tenant `status`

### 9. Metering enforcement

- [ ] `reserveUsage()` before discovery runs and before sends — **only after** the
      atomic Postgres version exists
- [ ] `releaseUsage()` when work doesn't happen
- [ ] Surface remaining quota in dashboard
- [ ] **Set real caps** — placeholder: Solo 500/1,000, Company 2,500/5,000

---

## Open product decisions

- [ ] Final monthly volume caps per tier
- [ ] Confirm Company seat count (5 is a starting point)
- [ ] Founding-customer discount for first 2–3 clients for a case study?
- [x] ~~Batch 3/5 tenant resolution~~ — **decided: signed token in the URL**
- [ ] **Two send ceilings**: `MANUAL_SEND_CAP = 100` vs `DAILY_SEND_CAP = 40`.
      Manual sending can do 2.5× what automation can. Intended?

---

## Running the business today — the part that makes money

Verified 2026-08-24. None of this is SaaS work; it is what the tool needs to
earn.

- [ ] **Resend tracking subdomain + GoDaddy CNAME.** 295 sent, 277 delivered,
      **0 opens ever recorded**. The webhook handlers and the `opened_at` /
      `clicked_at` columns exist; Resend simply never emits the events without a
      tracking subdomain. Until this resolves, no copy or targeting decision can
      be evidence-based. *(As of 2026-08-24 no tracking CNAME resolves on the
      domain — re-check `dig +short track.fullstackservicesllc.net CNAME`.)*
- [ ] **168 leads have a phone and no email** — 51% of the live database, and
      unmailable. Enrich for addresses, or work them through the call queue?
- [ ] **85 leads sit at `Email 3 Sent`** with no defined next motion. The
      sequence ends and nothing happens. Call, break-up email, re-engage window?
- [ ] **Discovery cadence vs send capacity.** 100 sends/day available, discovery
      runs Mondays only. The queue drains in a day or two and then idles.
- [ ] **Two send ceilings** — `MANUAL_SEND_CAP = 100` vs `DAILY_SEND_CAP = 40`.
      Manual does 2.5x automation. Intended?

---

## Loose ends (not blocking SaaS)

- [x] ~~`border-[#125740]/30/15`~~ — 11 double-opacity classes fixed; prod HTML
      now serves 0 (was 47 on `/`, 2 on `/login`)
- [x] ~~3 unscored leads~~ — Mondragon 85, Airtron 72, MODERN HVAC 85, Reliant 92.
      Sendable queue 23 → 27.
- [x] ~~`Bad Email` review~~ — of the 15 not marked by a real bounce, **zero**
      have a live MX. Genuinely dead. The 4 that looked recoverable had all
      hard-bounced, and a bounce outranks an MX record.
- [x] ~~landing rewrite branch-only~~ — shipped to `main` in `e94fa83`
- [ ] Vercel `*_PROVIDERS` still name Kablewy. Harmless: prod holds no
      `KABLEWY_API`, and `lib/ai-providers.ts` skips any provider without a key.
      Left alone rather than overwrite Sensitive vars that cannot be read back.

---

## Verified state, 2026-08-23

| Subsystem | Status | Evidence |
|---|---|---|
| Login / auth | ✅ working | 7/7 prod checks with real credentials |
| Email sending | ✅ working | 2 real sends today, `status=sent` via Resend |
| Reply polling | ✅ working | `HTTP 200 {"scanned":11,"matched":0}` — reads the real mailbox |
| Send caps | ✅ correct | By Phoenix day: 28 / 40 / 100 / 100 — both caps held exactly |
| CAN-SPAM gate | ✅ passing | `blockedReason: null`, real street address set |
| AI providers | ⚠️ degraded | 11/22 pairs; every chain has ≥2 healthy (Ollama, Groq, Gemini) |
| Cron failure alerts | ❌ dead | `OWNER_ALERT_EMAIL` unset in prod |
| Multi-tenancy | ❌ not built | no `tenant_id` in the live DB, no signup, no Stripe |

**Provider detail:** Gemini ✅, Ollama ✅ (`gpt-oss:120b-cloud`), Groq ✅,
Anthropic ❌ credit balance too low, Kimi ❌ 429 quota, Kablewy ❌ NXDOMAIN (removed).
