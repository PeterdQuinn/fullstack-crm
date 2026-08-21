# SaaS Conversion — Goal & TODO

> **Read this first.** Brief for whoever picks this up, including a fresh AI agent.
> Last verified: 2026-08-21. Branch `saas-multi-tenant`, base commit `e55e330`.

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
- [x] Login + session auth (`lib/session.ts`, `app/api/auth/*`, middleware gate)
- [x] HVAC research intelligence
- [x] Tenant schema written — `supabase/migrations/011_multi_tenant.sql` (**not applied**)
- [x] `lib/tenant.ts` — `tenantScope()`, `tenantSecrets()`, `reserveUsage()`, `PLAN_LIMITS`
- [x] **All work committed** — was local-only, now on branch `saas-multi-tenant` @ `e55e330`
- [x] **Route survey complete** (2026-08-21) — findings in step 2 below
- [x] **Provider chain tested with real calls** (2026-08-21) — results at bottom

---

## 1. Apply the tenant migration

`011_multi_tenant.sql` is written but **not applied**.

- [x] Verified: routes touch 10 tables, migration covers 12. **No gaps.**
      (`appointments, call_logs, cron_failures, follow_up_tasks, lead_ai_summaries,
      lead_notes, lead_research_facts, lead_socials, leads, outreach_log`)
- [ ] Test on a Supabase branch or DB copy first, never straight at prod
- [ ] Verify backfill ran before `NOT NULL` landed (357 leads must all get a `tenant_id`)
- [ ] Confirm founding tenant row exists and owns all existing rows
- [ ] Spot-check `current_tenant_id()` returns the right tenant for a test user

---

## 2. Migrate the API routes to `tenantScope()`  ← the big one

### Survey findings (2026-08-21)

| Fact | Value |
|---|---|
| Routes total / touching Supabase | 52 / 38 |
| Shared query helper | **None** — 38 identical hand-rolled imports |
| `createClient(` per file | exactly 1, uniform shape |
| **Built at module scope (col 0)** | **38 / 38** |
| Built inside a handler | **0** |
| `.rpc()` calls | **0** — nothing escapes the wrapper |

**The module-scope client is the real blocker.** `const supabase = createClient(...)`
at file top-level is built once per warm lambda and shared across requests from
different tenants. No request context exists at construction time, so it cannot be
tenant-scoped where it sits. All 38 must move inside the handler. Not a find-and-replace.

**Gaps in `tenantScope()` to close first:**
- [ ] No `.upsert()` — needed by 7 calls in 5 files (`crm/research-center`,
      `admin/bulk-score-and-clean`, `ai/summarize`, `cron/process-discovered-leads`)
- [x] Chaining verified OK: `.single()` ×22, `.maybeSingle()` ×9, `.order()` ×17,
      `.limit()` ×16, `.in()` ×10, `.or()` ×4 all chain off the builder

### Batches (leak test after each; red = stop, do not start the next)

- [ ] **Batch 0** — add `upsert` to `tenantScope()`; `requireTenant(req)` helper;
      build leak-test harness; ESLint rule banning `@supabase/supabase-js`
      imports outside `lib/` so fixed routes can't regress
- [ ] **Batch 1** — `crm/*` — 17 routes, 16 writes — tenant from session
- [ ] **Batch 2** — `admin/*` — 11 routes, 3 writes — session + role check
- [ ] **Batch 3** — `email/*` — 8 routes, 9 writes — ⚠️ mixed, see decision below
- [ ] **Batch 4** — `cron/*` — 8 routes, 17 writes — loop per tenant
- [ ] **Batch 5** — `webhooks/resend` — 1 route, 8 writes — tenant from payload
- [ ] **Batch 6** — `ai/*`, `appointments`, `scrape-phone` — 5 routes — session

**BLOCKED — needs Peter's decision:** email tracking pixels, unsubscribe links, and
the Resend webhook have no session. Either (a) encode a signed tenant token in every
tracking/unsubscribe URL, or (b) resolve tenant from the lead/message ID in the
payload. (b) is less work; (a) is harder to forge.

---

## 3. Cross-tenant leak tests

Built in Batch 0, run after every batch.

- [ ] Two tenants seeded with data in each
- [ ] Tenant A cannot read B's leads, summaries, facts, replies, bookings
- [ ] Tenant A cannot write into B by forging a `tenant_id` in a payload
- [ ] Unauthenticated request gets nothing
- [ ] Cron scoped to A never touches B

---

## 4. Stripe billing

- [ ] `npm i stripe`
- [ ] Prices: Solo $600/mo + $1,000 setup, Company $1,000/mo + $3,000 setup
- [ ] Annual: Solo $6,000/yr, Company $10,000/yr
- [ ] Checkout charging setup fee + first subscription payment in one flow
- [ ] Monthly vs annual-upfront toggle
- [ ] Webhook `checkout.session.completed` → `setup_fee_paid`, `status = active`
- [ ] `past_due` / `cancelled` → gate access on `tenants.status`
- [ ] Setup fee one-time, non-refundable

---

## 5. Signup + onboarding

- [ ] `app/signup` — creates tenant + `tenant_members`, then Stripe Checkout
- [ ] Apply `PLAN_LIMITS` from chosen plan
- [ ] Niche questionnaire: ICP, niche, territories, differentiators, offer
- [ ] Generate `tenant_configs.generated_config` from answers
- [ ] Connect AI keys → `tenant_secrets` (kind `ai_provider`)
- [ ] Connect inbox + calendar → `tenant_secrets` (kind `inbox` / `calendar`)

---

## 6. Bring-your-own-AI wiring

- [ ] `lib/ai-providers.ts` reads keys from `tenantSecrets()`, not `process.env`
- [ ] Never fall back to our keys — fail loudly
- [ ] Per-tenant provider chain order in `tenant_configs`

---

## 7. Auth cutover

- [ ] Supabase Auth signup/login for tenant customers
- [ ] Keep existing `APP_USERNAME` / `APP_PASSWORD` session login working
- [ ] Decide whether Basic Auth stays as founder-only back door
- [ ] Gate `/crm/*` on tenant `status`

---

## 8. Metering enforcement

- [ ] `reserveUsage()` before discovery runs and before sends
- [ ] `releaseUsage()` when work doesn't happen
- [ ] Surface remaining quota in dashboard
- [ ] **Set real caps** — placeholder: Solo 500/1,000, Company 2,500/5,000

---

## 9. Open product decisions

- [ ] Final monthly volume caps per tier
- [ ] Confirm Company seat count (5 is a starting point)
- [ ] Founding-customer discount for first 2–3 clients for a case study?
- [ ] Batch 3/5 tenant resolution — signed token vs payload lookup (see step 2)

---

## Provider chain — real test calls, 2026-08-21

| Provider | Result | Evidence |
|---|---|---|
| **Gemini** | ✅ **LIVE** http 200 | Returned "OK"; second call "7*6?" → **42** |
| **Ollama** | ✅ **LIVE** http 200, 573ms | `gpt-oss:120b-cloud` returned "OK" |
| Anthropic | ❌ http 400 | "Your credit balance is too low" |
| Kablewy | ❌ fetch failed | `api.kablewy.com` → **NXDOMAIN** |
| Groq | ⚠️ untested | **No `GROQ_API_KEY` in `.env.local`** — prod only? |
| Kimi | ⚠️ untested | No `KIMI_API_KEY`/`MOONSHOT_API_KEY` locally |

**Corrections to the old TODO:**
- Gemini is **not** revoked. The local key answered 200 twice. If prod is 401ing,
  prod holds a different, stale key — a working provider is sitting idle.
- Groq has no local key at all, yet was believed to be carrying the app.
  **Local and prod env have diverged.** Reconcile before trusting either.

- [ ] Compare `.env.local` vs Vercel prod env for `GEMINI_API_KEY` and `GROQ_API_KEY`
- [ ] Drop Kablewy from the chains (domain is dead)
- [ ] Drop or refund Anthropic in the chains until credit is restored
