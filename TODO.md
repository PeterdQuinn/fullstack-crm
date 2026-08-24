# SaaS Conversion — Goal & TODO

> **Read this first.** Brief for whoever picks this up, including a fresh AI agent.
> Last verified: 2026-08-23. Branch `saas-multi-tenant`, rebased onto `main` @ `a5e230e`.

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

- [ ] **BLOCKED** — needs `npx supabase login` (interactive browser auth) or
      `SUPABASE_ACCESS_TOKEN`. Project ref `opqzcdukaaoejrvtzdum`, already linked.
      No Docker on this machine, so a local stack is not an option.
- [x] Verified: routes touch 10 tables, migration covers 12. **No gaps.**
- [ ] Verify backfill ran before `NOT NULL` landed (368 leads must all get a `tenant_id`)
- [ ] Confirm founding tenant row exists, `is_founding = true`, and owns all existing rows
- [ ] Add an **atomic** `reserve_usage()` Postgres function — see the warning in
      `lib/tenant.ts`. The JS version is read-then-write and races.
- [ ] Spot-check `current_tenant_id()` returns the right tenant for a test user

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

- [ ] **Batch 1** — `crm/*` — 17 routes, 16 writes — tenant from session
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

## Loose ends (not blocking SaaS)

- [ ] `border-[#125740]/30/15` — double opacity modifier, Tailwind drops it
      entirely so the border renders invisible. 16 occurrences in `app/page.tsx`,
      `app/login/page.tsx`, `app/_landing/Reveal.tsx`.
- [ ] 3 requeued leads (Mondragon, Airtron, Modern HVAC) have no AI score and
      need the scoring phase before they enter the queue
- [ ] 22 leads still in `Bad Email` — believed genuinely dead, worth one look
- [ ] `app/page.tsx` landing rewrite is still branch-only, not on `main`

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
