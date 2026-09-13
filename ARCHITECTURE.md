# Full Stack CRM — Architecture

A single-operator cold-outreach CRM that runs itself. It discovers local
businesses, finds their contact details, researches them, scores them, writes
and sends a three-touch email sequence, reads the replies, and books the
meeting. A human is required for the sales conversation and nothing else.

| | |
|---|---|
| **Stack** | Next.js 14 (App Router) · TypeScript · Supabase/Postgres · Tailwind |
| **Size** | ~16,000 lines across `app/` and `lib/` · 55 API routes · 13 CRM pages · 40 libs · 19 migrations |
| **Deploy** | Vercel, auto-deploy from `main` → `fullstack-crm-nine.vercel.app` |
| **Scheduler** | GitHub Actions (`.github/workflows/cron.yml`) — `vercel.json` declares no crons |
| **Auth** | Signed session cookie from `/login` (`lib/session.ts`), verified in middleware; HTTP Basic accepted as a second door; `CRON_SECRET` on every `/api/cron/*` verb; provider signatures on webhooks |
| **Targeting** | Owner-editable niches × US cities, stored in `automation_settings`, rotated one pairing per run by `next_discovery_target()` |
| **Outreach markets** | `lib/outreach-markets.ts` defaults to `*` (any named niche) and still fails closed on a lead with no market. Narrow it with `OUTREACH_MARKETS`. |
| **Master switch** | `automation_settings.enabled`. Every scheduled stage checks it before doing anything. Toggled at `/crm/automation`. |

---

## The Pipeline

```
DISCOVER → ENRICH → RESEARCH → SCORE → SEND → FOLLOW UP → REPLIES → BOOK
```

Each stage is an HTTP endpoint under `/api/cron/`, fired by GitHub Actions and
wrapped in `withAutomationRun()`, which checks the cron secret, honours the
pause flag, and writes a row to `automation_runs` recording the stage, status,
result and duration. A stage that returns errors is recorded as failed rather
than reported green.

### 1. Discover — `cron/discover-leads`, daily
Two sources, deduplicated against existing leads before anything is written.

- **Google Places (New)** — `places:searchText`. A weekly cap is reserved in the
  database *before* any HTTP call, so cost cannot run away.
- **OpenStreetMap Overpass** — free second source. Mirrors are queried in
  parallel (`Promise.any`), so one busy server cannot zero out a run.

The niche and city come from `next_discovery_target()`, which advances a cursor
through the owner's saved lists. Manual mode (`/crm/discovery`) takes a niche,
city, state, ZIP, radius, and quality filters. Results are AI-cleaned and
structured before import. Deduplication now runs *before* the result limit, so a
run that mostly rediscovers known businesses still returns a full batch of new
ones.

`lib/discovery-pipeline.ts` · `lib/discovery-sources.ts` · `lib/discovery-clean.ts` · `lib/targeting.ts`

### 2. Enrich — `cron/enrich-leads`, 3×/day

**This stage is the constraint on the whole system.** Measured 2026-09-12: 169
leads stood at *Ready for Outreach* and exactly one had an email address, while
196 had a website and none. Nothing downstream can send what this stage does not
find.

A static crawl of the business's own site, walking internal links and merging
what each page yields: email, phone, owner name, address, description, booking
or dispatch software, website technologies, social profiles, Google Business
profile. HVAC-specific signals (`lib/hvac-signals.ts`) still exist for the
trades — booking, after-hours capture, financing, maintenance plans, brands,
certifications, licence numbers.

Twenty leads per run against a 75-second budget, so the route cannot outrun its
120-second ceiling — the static scrape now averages about two seconds. Supply, not the send cap, is the binding constraint on this
system: enrichment is what converts a discovered business into a mailable one.

Addresses are read from the **markup**, not `$("body").text()`: Cloudflare's
XOR-obfuscated mailto, JSON-LD, meta tags and `info [at] example [dot] com` all
carry an address no text scan can see. What is found is then *ranked* — the
site's own domain wins, and an address on a third-party company domain is
rejected, because the first live run of the new extractor returned the web
designer's footer credit. A blocked page is retried once as a full browser
navigation, and a transport failure falls back to the www/apex twin.

`app/api/scrape-phone/route.ts` · `lib/email-extract.ts` · `lib/enrich.ts` · `lib/hvac-signals.ts`

### 3. Research — `cron/research-leads`, 3×/day
Its own scheduled stage, not a passenger on enrichment: one lead's research is
four Firecrawl searches, up to five page scrapes and an LLM read, and can take
70 seconds on its own.

Grouped searches cover BBB/licensing/reputation, hiring, geographic expansion,
advertising and technology adoption. Results must pass an identity gate on
domain, name, phone, address, owner and geography before a page is opened.
Accepted pages are reduced to dated observations in
`lead_internet_observations`, and a footprint and momentum score are written to
`lead_internet_intelligence`.

**Two separate outputs, and only one may reach a prospect.**

- *Keyword observations* are sentences matched by pattern. They are useful to a
  human reading the call queue or research page and are **never** used in
  outreach copy — on live data they surfaced BBB disclaimers, directory listing
  titles and the company's own marketing slogans.
- *An outreach fact* is produced by an LLM reading the same pages and returning
  one specific, checkable, third-person sentence about that business, or
  nothing. Nothing is the correct answer more often than not. This is the only
  observation permitted into an email.

`verified` now requires two independent sources; a single confident scrape is
`single_source`.

`lib/lead-research.ts` · `lib/internet-intelligence.ts` · `lib/fact-extraction.ts` · `lib/research-evidence.ts`

### 4. Score — `cron/process-discovered-leads`, 3×/day
The AI produces the pain point, attack angle, a first message, a follow-up, a
0–100 score and what still needs confirming. Score and the status change it
implies commit together through `save_automation_score()`.

The bar is **20**, defined once in `lib/score-thresholds.ts` and mirrored by
`save_automation_score` (migration 019) — the database held its own copy of the
old 50 and would otherwise have parked every newly scored lead at *Scored*. An
exact 50 is excluded everywhere: it is the literal value written when every
provider fails, and a lead holding one is re-scored by
`cron/process-discovered-leads` rather than mailed.

Scoring **fails loudly**: if every provider is down, the lead is left for the
next run rather than promoted to *Ready for Outreach* on a fallback 50.

`lib/ai-scoring.ts` · `app/api/cron/process-discovered-leads/`

### 5. Send — `cron/automation`, 3×/day
Sends first-touch emails to leads scoring at least 20 in an approved market,
preferring leads that have a verified outreach fact so the scarce daily budget
goes to the personalised opener.

**Every email goes through a transactional outbox.** The message is saved before
it is sent, reserved by `claim_email_outbox()`, and committed by
`finalize_email_outbox()`. The log row, lead progress, audit entry and next
follow-up task commit in one database transaction or not at all — a crash
between the provider accepting a message and the bookkeeping landing can no
longer leave a lead mailed but untracked.

- Reservation is serialised by an advisory lock, so the daily cap holds across
  concurrent senders.
- A send left unconfirmed past 23 hours moves to `needs_review` rather than
  being replayed after the provider has forgotten the idempotency key.
- `cron/automation` runs `recoverEmailOutbox()` first, repairing anything an
  interrupted run left behind.

`lib/email-outbox.ts` · `lib/resend.ts` · `lib/email-templates.ts` · `lib/email-sequence.ts` · `lib/email-validation.ts`

### 6. Follow up — `cron/process-followups`, hourly
Touches 2 and 3, three days apart, sent when due. This is the path that knows
how to stop on a reply, which is why `lib/automation.ts` deliberately keeps a
narrower `SENDABLE_STATUSES` for touch 1.

### 7. Replies — `cron/poll-replies`, hourly
The owner's Outlook mailbox is polled through Microsoft Graph. Matching a reply
to a lead has three tiers, each required to be unambiguous:

1. **Address** — exact match on `leads.email`.
2. **Thread** — the reply quotes a subject we actually sent (`Re:`/`Fwd:`
   stripped). Accepted only when exactly one lead was sent that subject.
3. **Company domain** — accepted only when the domain is not a shared mail
   provider and exactly one lead uses it. 24 public providers are excluded:
   matching `gmail.com` alone once paired a reply from one person to an
   unrelated lead on the same free provider.

This matters because 57% of the mailable list is a role inbox, so the likeliest
real reply arrives from an address we never wrote to. Every match records *how*
it matched.

Each reply is classified into eight categories and acted on:

- **Interested** → Calendly link sent, status *Booking Link Sent*
- **Not interested** → Do Not Contact
- **Unclear** → follow-up task for a human

`lib/graph-inbox.ts` · `lib/reply-actions.ts` · `lib/reply-policy.ts`

### 8. Book and close
Calendly link, call queue with logged outcomes, bookings, onboarding hand-off.

---

## Delivery feedback

The Resend webhook handles `delivered`, `bounced`, `complained`, `failed`,
`opened` and `clicked`.

**Open and click tracking are enabled** (`open_tracking` / `click_tracking` on
the Resend domain, turned on 2026-09-09 and verified end to end by reading a
sent message back out of the mailbox and confirming the pixel and rewritten
links). Historical sends predate it and will always read 0% opened.

Sending domain: `fullstackservicesllc.net`, verified in Resend — DKIM on the
root, MAIL FROM on `send.`, SPF passing on the envelope domain. Authentication
has never been the problem.

Measured as of 2026-09-09: **353 sent, 334 delivered (94.6%), 9 bounced (2.5%),
0 complaints, 0 replies.** Mail is reaching inboxes; nothing has answered.

---

## Suppression is per channel, not per lead

A bounce says an address is dead. It does not say the business asked to be left
alone, and it does not disconnect their phone.

| Kind | Meaning | What still works |
|---|---|---|
| `permanent` | `opt_out`, `complained`, *Do Not Contact* — a person asked to stop | Nothing. No channel, ever. |
| `address` | Hard bounce, or an address rejected before sending | Phone, and finding a better address |
| `transient` | Full mailbox, throttle, temporary failure | Retry the same address |

Every bounce records Resend's bounce type and the receiving server's
diagnostic; the pre-send mailability check records its own reason and transient
flag. `/crm/suppressed` shows the reason and offers the three things worth
doing — retry, find a new address, or move to the call queue — and refuses to
act at all on a lead whose owner asked to stop.

`lib/suppression.ts` · `app/api/crm/suppressed/action/`

---

## AI Layer

`lib/ai-providers.ts` is a shared registry of task-specific chains, each ordered
by an env var and failing over provider by provider. Only providers holding a
key are called; reordering needs no code change.

| Task | Env var | Used by |
|---|---|---|
| Reply classification | `CLASSIFIER_PROVIDERS` | `classifyReply` |
| Lead scoring | `SCORING_PROVIDERS` | `scoreLead` |
| Email drafting / summaries | `DRAFT_PROVIDERS` | `generateLeadSummary` |
| Discovery cleanup | `CLEANUP_PROVIDERS` | `cleanAndStructureLeads` |
| Outreach fact extraction | `EXTRACTION_PROVIDERS` | `extractOutreachFact` |

Providers: Ollama, Groq, Gemini, Kimi, Anthropic, Kablewy. Free and cheap tiers
head every chain. `scripts/ai-health-check.mjs` probes every provider × chain
pair with real calls.

Gemini and Ollama carry the work in practice. Kimi and Anthropic are
quota/credit blocked; `api.kablewy.com` does not resolve, so it fails on DNS in
about zero milliseconds and costs nothing sitting in the chain.

---

## External services

| Service | Used for | Guard |
|---|---|---|
| **Google Places (New)** | Discovery | Weekly cap reserved in the DB before any call (`GOOGLE_PLACES_WEEKLY_CAP`, default 100 ≈ $3/week) |
| **OpenStreetMap** Overpass + Nominatim | Free second discovery source, geocoding | Parallel mirrors, first usable answer wins |
| **Firecrawl** | Internet research: search + page scrape | Per-lead 70s hard cap; 2 leads per run |
| **Resend** | Sending, delivery webhooks, open/click tracking | Transactional outbox, idempotency keys, daily cap |
| **Microsoft Graph** | Reading the owner's Outlook inbox | Fails loudly (503) when unconfigured |
| **Calendly** | Booking | Single link, no OAuth |
| **Supabase / Postgres** | All state | RLS on, service role from the server only |
| **Vercel** | Hosting | Auto-deploy from `main` |
| **GitHub Actions** | Scheduling | `CRON_SECRET` on every call |

---

## Data Model

Supabase/Postgres, service-role access from the server only (RLS on, no anon
policies).

| Table | Holds |
|---|---|
| `leads` | The business record, its status, and its suppression reason/kind |
| `lead_ai_summaries` | Pain point, angle, messages, score, confidence |
| `lead_research_facts` | Per-field evidence with certainty and source URL |
| `lead_internet_observations` | Dated internet signals, including the one LLM-extracted outreach fact |
| `lead_internet_intelligence` | Footprint and momentum scores per lead |
| `lead_socials` | Discovered social/Google profiles |
| `email_outbox` | Every outbound message, its reservation state and provider id |
| `automation_settings` | The pause flag, saved niches and cities, discovery cursor |
| `automation_runs` | Every scheduled run: stage, status, result, duration |
| `status_audit_log` | Append-only trail of who changed what and why |
| `follow_up_tasks` | Scheduled touches and human tasks |
| `outreach_log` | What was sent and what happened to it (delivered/opened/clicked/bounced/replied) |
| `appointments` / `call_logs` / `lead_notes` | Close-stage records |
| `cron_failures` | Legacy automation error trail |
| `lead_discovery_config` | Google weekly quota counter |

Database functions carry the transactional work: `claim_email_outbox`,
`finalize_email_outbox`, `save_automation_score`, `next_discovery_target`.

29 lead statuses drive the UI, coloured from one source of truth
(`tailwind status.*` → `lib/status-colors.ts`). Queue membership lives in
`lib/queue-definitions.ts` so a dashboard badge and the page it links to cannot
disagree.

---

## Automation schedule

Nine cron endpoints, each guarded by `CRON_SECRET` on every verb — middleware
deliberately exempts `/api/cron`, so an unguarded verb would be world-callable.

Phoenix is UTC-7 year round. `lib/automation-schedule.ts` mirrors the workflow
so the UI can say when a stage next runs; a contract test asserts the two agree.

| UTC | Phoenix | Stage |
|---|---|---|
| 13:00 | 06:00 | `discover-leads` |
| 14:00, 17:00, 20:00 | 07:00, 10:00, 13:00 | `enrich-leads` |
| 14:45, 17:45, 20:45 | 07:45, 10:45, 13:45 | `research-leads` |
| 15:00, 18:00, 21:00 | 08:00, 11:00, 14:00 | `process-discovered-leads` |
| 16:00, 19:00, 22:00 | 09:00, 12:00, 15:00 | `automation` (send) |
| 14:30–23:30 hourly | 07:30–16:30 | `poll-replies` |
| 14:35–23:35 hourly | 07:35–16:35 | `process-followups` |
| 01:00 | 18:00 | `daily-digest` |

`cron/send-daily-emails` is legacy and not scheduled.

**The digest is the dead-man switch.** It reads `automation_runs`, names failed
and stalled stages in plain language, and raises `CRM ALERT` in the subject
line — including for the quietest failure of all: every stage green while
nothing was sent and mailable leads were waiting.

---

## Interface

Desktop sidebar, mobile bottom tab bar (`app/crm/_components/CrmNav.tsx`).

| Page | Purpose |
|---|---|
| `automation` | Running or paused, what ran, what failed, when each stage next fires, and the targeting lists |
| `unified-dashboard` | Today's numbers and what needs action |
| `replies` | Inbound replies and their classification |
| `call-queue` | Leads to phone, with outcome logging |
| `bookings` | Scheduled meetings |
| `discovery` | Manual + auto lead scraping |
| `dm-queue` | **Research Center** — facts, weaknesses, sources |
| `email-queue` | Outbound review and send |
| `onboarding` | Won-deal hand-off |
| `leads` | Full searchable table |
| `suppressed` | Why each lead is suppressed, and what can still be done |
| `reports` | Every stage, the send funnel with rates, and supply |

Theme: NY Jets palette — Gotham Green `#125740` primary (`brand`), Kelly Green
accent, Stealth Black, Streak White. Status colours stay distinct from the brand
so warnings stay readable. Contrast is WCAG AA throughout.

**Read routes must never be served stale.** `force-dynamic` alone does not stop
Next caching supabase-js's own fetch; every read route also sets
`fetchCache = "force-no-store"` and wraps the client's fetch with
`cache: "no-store"`. Without it the automation page reported the system paused
while it was sending.

---

## Cost controls

- Google Places weekly cap, reserved in the DB before any HTTP call, refunded
  when a request is rejected for credentials
- OpenStreetMap as a free second discovery source
- Firecrawl bounded to 2 leads per run with a 70s per-lead cap (~8 credits/lead)
- Free/cheap AI tiers at the head of every provider chain
- `DAILY_SEND_CAP` (default 40) overridable by env, so a cold sending domain can
  be warmed slowly
- Per-request timeouts and retry/backoff on every external call

---

## Testing

`npm test` runs four suites — reply policy, the automation contract, AI
normalisation, and the cron workflow. The contract test is the important one:
it reads the source and asserts the properties that have broken before, so a
regression fails the build rather than the pipeline. 180 checks in the automation contract alone.

`scripts/outbox-database-test.sql` exercises the outbox transaction against a
real database inside `BEGIN … ROLLBACK`: reservation, replay, saved
log/status/audit/followup, suppression survival, and the expired-retry cutoff.

---

## Key files

| Path | Role |
|---|---|
| `middleware.ts` | Session/Basic auth over the CRM and private APIs; exempts `/api/cron` |
| `lib/ai-providers.ts` | Shared LLM layer, chains, retries |
| `lib/automation.ts` | Send phase and pipeline state machine |
| `lib/automation-runs.ts` | Cron auth, pause gate, run recording |
| `lib/automation-schedule.ts` | The schedule the UI reads |
| `lib/email-outbox.ts` | Transactional send path |
| `lib/lead-research.ts` | Scheduled internet research |
| `lib/fact-extraction.ts` | The one observation allowed into an email |
| `lib/suppression.ts` | Per-channel suppression semantics |
| `lib/queue-definitions.ts` | What is in each queue, defined once |
| `lib/targeting.ts` | Niche and location defaults, niche validation |
| `lib/status-colors.ts` | Single source of truth for status colours |
| `lib/lead-stats.ts` | Single source of truth for KPIs |
| `lib/audit.ts` | Append-only change trail |
| `supabase/migrations/` | Schema history (019 current) |

## Insurance workspace

`/crm/insurance` provides separate recruiting and public buyer-signal research for AZ, SC, VA, OH, and MI. Migration 018 adds isolated prospects, search cache, and atomic monthly usage counters; HVAC automation does not query these tables. Saved profiles support notes, stages, evidence-backed license dates, and follow-up dates. Unknown dates stay unknown.

Search uses the imported `PRODUCERFORGE_OLLAMA_API_KEY` against the hosted web-search API, with `SERPAPI_API_KEY` as fallback. Results are source snippets for review, not verified license records or confirmed buyers. Repeated searches are cached for one hour. Requests have deadlines; each provider is capped at 100 requests per month. No localhost AI service or filesystem usage counter is required.

Drafts are instant templates with Peter's website and Calendly link. Optional editing uses the two imported `PRODUCERFORGE_GEMINI_API_KEY` credentials with bounded fallback to the template. Drafts do not send messages. Insurance sending, reply automation, official license feeds, carrier integrations, and migration of existing ProducerForge workspace records are not implemented.

Verification: `npm run test:insurance`; live search, persistence, and draft checks use the authenticated `/api/crm/insurance/*` routes. Secrets remain server-side.
