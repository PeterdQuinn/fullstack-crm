# SaaS Conversion — Goal & TODO

> **Read this first.** This file is the brief for whoever picks the work up,
> including a fresh AI agent with no memory of how we got here.

## What this app is

An **AI-driven cold-outreach CRM**, being converted from a single-operator tool
into a **multi-tenant SaaS** we sell to other operators.

The product's spine is one pipeline:

```
DISCOVER → ENRICH → RESEARCH → [APPROVE: human gate] → OUTREACH → REPLIES → CLOSE
```

- **Discover** — find businesses matching the customer's niche (Google Places + OpenStreetMap)
- **Enrich** — crawl each business's own site for real signals
- **Research** — find the pain point, size the dollar impact, draft the outreach
- **Approve** — the operator decides before anything sends. This gate never opens itself.
- **Outreach** — a tracked email sequence from the customer's own inbox
- **Replies** — poll, classify, act (interested → booking link; not interested → suppress; unclear → human task)
- **Close** — call queue, bookings, reporting

## The goal

Sell this as a product. Each customer connects **their own AI provider and keys**,
so the engine runs on their data, in their network, trained on their niche.

| Plan | Setup (one time) | Monthly | Annual (two months free) |
|---|---|---|---|
| Solo | $1,000 | $600/mo | $6,000/yr |
| Company | $3,000 | $1,000/mo | $10,000/yr |

Solo: 1 login, 1 niche, 1 inbox. Company: up to 5 logins, multiple niches and
territories, several inboxes, shared pipeline, priority support.

The setup fee is not a signup charge. It pays for wiring the customer's AI into
their network and generating their niche config from a questionnaire. That
questionnaire → config step is literally what the fee sells.

## Why bring-your-own-AI matters

- **The pitch:** "Your AI, your keys, your data, your network. It never leaves your control."
- **The margin:** the customer pays their own AI bill; our only per-tenant cost is shared infrastructure.
- **No lock-in fear:** they own the AI relationship, which lowers the barrier to saying yes.

## Non-negotiable guardrails

1. **Tenant isolation.** Customer A must be unable to read or write Customer B's
   data. A single cross-tenant leak kills the business.
2. **Never hardcode our AI keys into a tenant's runtime.** Always use the
   tenant's stored provider config. Fail loudly rather than falling back to ours.
3. **Keep the evidence-grading discipline.** A negative only ever claims "not
   found on pages read." A thin page returns unknown rather than a fabricated
   gap. Never invent a fact to fill a hole.
4. **Suppression is global per tenant.** opt-out / bounced / complained /
   Do-Not-Contact blocks every outreach path.
5. **Bring-your-own-inbox.** Customers send from their own connected inbox. Do
   not build shared sending infrastructure — deliverability is theirs, not ours.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase/Postgres (RLS on,
service-role server-only) · Vercel. The AI layer is `lib/ai-providers.ts`, which
already supports per-provider keys and task-specific chains — that is what makes
bring-your-own-AI possible.

## How the work gets done

**The AI agent does the implementation.** Peter directs, decides, and approves;
the agent writes the code, the migrations, and the tests. When picking this up:

- Work top to bottom. Each step below depends on the one above it.
- Verify with real calls against real data before reporting anything done.
- Do not apply migrations or deploy without being asked.
- Flag conflicts with this brief rather than silently resolving them.

---

## Status

Done: landing page with full pricing, login (session auth against the existing
credentials), HVAC research intelligence, tenant schema (`011_multi_tenant.sql`,
**not yet applied**), and `lib/tenant.ts` (scoped queries, per-tenant secrets, metering).

Everything below is what's left.

---

## 1. Apply the tenant migration

`supabase/migrations/011_multi_tenant.sql` is written but **not applied**.

- [ ] Test on a Supabase branch or a DB copy first, never straight at prod
- [ ] Verify the backfill ran before `NOT NULL` landed (357 leads must all get a `tenant_id`)
- [ ] Confirm the founding tenant row exists and owns all existing rows
- [ ] Spot-check `current_tenant_id()` returns the right tenant for a test user

**Risk:** run out of order and every existing row orphans. The migration handles
the ordering, but confirm it on a copy before trusting it.

---

## 2. Migrate the API routes to `tenantScope()`  ← the big one

Until this is done the app is still effectively single-tenant. ~50 routes.

- [ ] Replace every request-scoped `createClient(...)` with `tenantScope(tenantId)`
- [ ] Resolve `tenantId` from the session at the top of each route
- [ ] Stamp `tenant_id` on every insert (a write without it is the same leak as a read)
- [ ] Cron routes: loop per tenant instead of running globally
- [ ] Webhooks: resolve tenant from the payload, not from a session

**Why it matters:** the service role bypasses RLS. RLS alone does not protect you.
Server code is the real last line of defence.

Priority order: `crm/*` → `admin/*` → `cron/*` → `webhooks/*`

---

## 3. Cross-tenant leak tests

Do this immediately after step 2, not at the end.

- [ ] Create two tenants with data in each
- [ ] Assert tenant A cannot read B's leads, summaries, facts, replies, bookings
- [ ] Assert tenant A cannot write into B by forging a `tenant_id` in a payload
- [ ] Assert an unauthenticated request gets nothing
- [ ] Assert cron scoped to A never touches B

A single leak kills the business. Treat a failure here as a stop-the-line bug.

---

## 4. Stripe billing

- [ ] `npm i stripe`
- [ ] Products/prices: Solo $600/mo + $1,000 setup, Company $1,000/mo + $3,000 setup
- [ ] Annual prices: Solo $6,000/yr, Company $10,000/yr (two months free)
- [ ] Checkout session charging setup fee + first subscription payment in one flow
- [ ] Monthly vs annual-upfront toggle at checkout
- [ ] Webhook handler: `checkout.session.completed` → set `setup_fee_paid`, `status = active`
- [ ] Handle `past_due` / `cancelled` → gate access on `tenants.status`
- [ ] Setup fee is one-time and non-refundable

---

## 5. Signup + onboarding

- [ ] `app/signup` — creates the tenant + `tenant_members` row, then Stripe Checkout
- [ ] Apply `PLAN_LIMITS` (seats, niches, inboxes, caps) from the chosen plan
- [ ] Niche questionnaire: ICP, target niche, territories, differentiators, offer
- [ ] Generate `tenant_configs.generated_config` from the answers
  (signal logic, research prompts, email angles)
- [ ] Connect their AI keys → `tenant_secrets` (kind `ai_provider`)
- [ ] Connect inbox + calendar → `tenant_secrets` (kind `inbox` / `calendar`)

This questionnaire → config step is literally what the setup fee sells.

---

## 6. Bring-your-own-AI wiring

- [ ] `lib/ai-providers.ts` reads keys from `tenantSecrets()`, not `process.env`
- [ ] Never fall back to our keys inside a tenant's runtime — fail loudly instead
- [ ] Per-tenant provider chain order stored in `tenant_configs`

---

## 7. Auth cutover

- [ ] Add Supabase Auth signup/login for tenant customers
- [ ] Keep the existing `APP_USERNAME` / `APP_PASSWORD` session login working
- [ ] Decide whether Basic Auth stays as the founder-only back door
- [ ] Gate `/crm/*` on tenant `status` (`pending` / `past_due` must not reach the pipeline)

---

## 8. Metering enforcement

- [ ] Call `reserveUsage()` before discovery runs and before sends
- [ ] `releaseUsage()` when the work doesn't happen (mirrors the Google quota refund)
- [ ] Surface remaining quota in the dashboard
- [ ] **Set the real caps** — currently placeholder: Solo 500 leads / 1,000 sends,
      Company 2,500 / 5,000

---

## 9. Open product decisions

- [ ] Final monthly volume caps per tier
- [ ] Confirm Company seat count (5 is a starting point)
- [ ] Founding-customer discount for the first 2–3 clients in exchange for a case study?

---

## Also outstanding (unrelated to SaaS)

- [ ] `GEMINI_API_KEY` is revoked — 401 on all chains. Reissue or drop it from the chains.
- [ ] Kimi suspended, Anthropic out of credit, Kablewy unreachable. Ollama + Groq are
      currently carrying the whole app.
- [ ] Nothing from today is committed. Landing, login, session auth, HVAC research,
      and the tenant scaffolding are all uncommitted local changes.
