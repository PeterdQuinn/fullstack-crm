# Full Stack CRM — Architecture

A single-operator, AI-driven cold-outreach CRM. It finds local service
businesses, researches them, drafts the outreach, sends it, classifies the
replies, and books the meeting — with a human approval gate at every stage.

| | |
|---|---|
| **Stack** | Next.js 14 (App Router) · TypeScript · Supabase/Postgres · Tailwind |
| **Size** | ~13,200 lines across `app/` and `lib/` · 50 API routes · 12 CRM pages |
| **Deploy** | Vercel, auto-deploy from `main` → `fullstack-crm-nine.vercel.app` |
| **Auth** | Signed session cookie from `/login` (`lib/session.ts`), verified in middleware; HTTP Basic still accepted as a second door; `CRON_SECRET` for cron; provider signatures for webhooks |
| **Discovery niche** | HVAC (hardcoded in `discovery-sources.ts` / `hvac-signals.ts`) |
| **Outreach markets** | Allowlist in `lib/outreach-markets.ts` — `hvac,landscaping` by default, `OUTREACH_MARKETS` to change. The copy stopped naming a trade in `11a356d`, so the gate is no longer pinned to HVAC. Live queue is currently 18 landscaping / 5 HVAC. |

---

## The Pipeline

```
DISCOVER → ENRICH → RESEARCH → APPROVE → OUTREACH → REPLIES → CLOSE
```

### 1. Discover
Two sources, deduplicated against existing leads before anything is written.

- **Google Places (New)** — `places:searchText`, weekly cap enforced in the DB
  *before* any HTTP call, so cost cannot run away.
- **OpenStreetMap Overpass** — free second source. Mirrors are queried in
  parallel (`Promise.any`); the first usable answer wins, so one busy server
  cannot zero out a run.

Manual mode takes city, state, ZIP, radius, max results, minimum rating,
minimum reviews, and require-phone/website/email. Auto mode rotates through
metros. Results are AI-cleaned and structured before import.

`lib/discovery-pipeline.ts` · `lib/discovery-sources.ts` · `lib/discovery-clean.ts` · `lib/state-rotation.ts`

### 2. Enrich
A headless-browser crawl of the contractor's own site, walking internal links
and merging what each page yields.

Generic: email, phone, owner name, address, description, booking/dispatch
software, website technologies, social profiles, Google Business profile.

HVAC-specific (`lib/hvac-signals.ts`): online booking, 24/7 emergency
messaging, financing, maintenance plans, free estimates, brands carried
(Trane/Carrier/Lennox/…), certifications (NATE/EPA 608/BBB/ACCA), services,
residential vs commercial, contractor license numbers, mobile-friendliness,
ad/analytics tracking, chat widget, review widget.

Each of those maps to a concrete revenue gap, ranked in the order a rep should
lead with — no online booking, no after-hours capture, no financing on
high-ticket replacements, no recurring maintenance revenue, and so on.

`app/api/scrape-phone/route.ts` · `lib/hvac-signals.ts` · `lib/enrich.ts`

### 3. Research
The AI produces the pain point, a dollar-sized impact in HVAC terms, the attack
angle, a first email that must cite a specific verifiable detail, a follow-up,
a 0–100 score, and what still needs confirming.

Every fact carries its evidence grade:

| Grade | Meaning |
|---|---|
| `verified` | Confirmed on the contractor's own site (or two agreeing sources) |
| `single_source` | One source only — includes "not found on the pages read" |
| `ai_inference` | Model estimate, explicitly not a company fact |
| `not_found` | No reliable value |

A positive is `verified`; a negative only ever claims "not found on pages
read"; a page too thin to have said anything returns *unknown* rather than
inventing a gap. Source links are listed for manual checking.

`lib/research-evidence.ts` · `lib/grok.ts` · `app/api/crm/research-center/`

### 4. Approve
Nothing reaches a contact without a decision: **Approve for Email**,
**Move to Calls**, **Needs More Research**, **Reject**, or **Do Not Contact**.
Guardrails block approval without an email, off-niche leads, scores ≤ 50, and
low-confidence research whose sources have not been ticked as reviewed.

Research also builds a dated internet-intelligence history through Firecrawl.
Grouped searches cover BBB/licensing/reputation, hiring, geographic expansion,
advertising and technology adoption; a site map measures web footprint. The UI
shows separate footprint and growth-momentum scores. Growth remains an explicit
inference backed by source links and repeat observations, never a revenue fact.
Search results must pass an identity gate using company domain, name, phone,
address, owner and geography. Accepted results are opened and reduced to dated
fact sentences; authoritative or independently corroborated facts are marked
verified. Those facts drive the Call Workspace preparation and personalize the
first email. Weak matches and unsupported AI claims never enter outreach copy.

### 5. Outreach
A three-step email sequence through Resend, with a shared footer carrying the
mailing address, and one-click unsubscribe (public by design — it is clicked
from the recipient's inbox). A scraped address is validated before use,
guarding against invented emails.

**Delivery feedback — what is and is not live.** The Resend webhook handles
`delivered`, `bounced`, `complained`, `failed`, `opened` and `clicked`. Only the
first four ever fire. Open and click tracking require a **tracking subdomain
configured in Resend with a matching CNAME at the DNS provider**, and that has
never been set up — no `track.` / `clicks.` / `link.` record exists on the
sending domain. The handlers and the `opened_at` / `clicked_at` columns are
built and waiting.

The measured effect, as of 2026-08-24: **295 sent, 277 delivered (93.9%), 8
bounced (2.7%), 0 opened, 0 clicked.** A 0% open rate across 277 delivered
messages is a missing configuration, not reader behaviour — until the subdomain
is set up there is no way to tell a message that was read from one that was
ignored, and no copy decision can be evidence-based.

*(This section previously stated open/click tracking was live. It never was —
that one line made the gap look solved to every reader, including AI agents
working on the repo.)*

`lib/email-templates.ts` · `lib/email-sequence.ts` · `lib/resend.ts` · `lib/email-validation.ts`

### 6. Replies
The owner's Outlook mailbox is polled via Microsoft Graph. Each reply is
classified into one of eight categories, then acted on automatically:

- **Interested** → Calendly link sent, status becomes *Booking Link Sent*
- **Not interested** → suppressed, Do Not Contact
- **Unclear** → follow-up task for a human

`lib/graph-inbox.ts` · `lib/reply-actions.ts` · `lib/reply-policy.ts` · `app/api/ai/classify-reply/`

### 7. Close
Call queue with logged outcomes, bookings, onboarding hand-off, and reporting.

---

## AI Layer

`lib/ai-providers.ts` is a shared registry with four task-specific chains, each
ordered by an env var and failing over provider by provider. Only providers
holding a key are called; reordering needs no code change.

| Task | Env var | Used by |
|---|---|---|
| Reply classification | `CLASSIFIER_PROVIDERS` | `classifyReply` |
| Lead scoring | `SCORING_PROVIDERS` | `scoreLead` |
| Email drafting / summaries | `DRAFT_PROVIDERS` | `generateLeadSummary` |
| Discovery cleanup | `CLEANUP_PROVIDERS` | `cleanAndStructureLeads` |

Providers: Ollama, Groq, Gemini, Kimi, Anthropic, Kablewy. Free and cheap tiers
sit at the head of each chain, paid providers at the tail. Model IDs are
overridable per provider. `scripts/ai-health-check.mjs` probes every
provider × chain pair with real calls.

**Health as of 2026-08-24** (`npm run ai:health`, 11/22 pairs passing):

| Provider | State |
|---|---|
| Ollama (`gpt-oss:120b-cloud`) | ✅ live, heads every chain |
| Groq | ✅ live |
| Gemini | ✅ live |
| Kimi | ❌ HTTP 429, quota exhausted |
| Anthropic | ❌ HTTP 400, credit balance too low |
| Kablewy | ❌ `api.kablewy.com` is NXDOMAIN — permanently dead, removed from the chains |

Every chain still has at least two healthy providers at its head, so the dead
tail costs nothing in practice — it is only reached if all three working
providers fail at once.

---

## Data Model

Supabase/Postgres, service-role access from the server only (RLS on, no anon
policies).

| Table | Holds |
|---|---|
| `leads` | The contractor record and its status |
| `lead_ai_summaries` | Pain point, angle, messages, score, confidence |
| `lead_research_facts` | Per-field evidence with certainty and source URL |
| `lead_socials` | Discovered social/Google profiles |
| `status_audit_log` | Append-only trail of who changed what and why |
| `follow_up_tasks` | Human tasks raised by unclear replies |
| `outreach_log` | What was sent, when |
| `appointments` / `call_logs` / `lead_notes` | Close-stage records |
| `cron_failures` | Automation error trail |
| `lead_discovery_config` | Metro rotation + the Google weekly quota counter |

Around 19 lead statuses drive the whole UI, colored from one source of truth
(`tailwind status.*` → `lib/status-colors.ts`). Suppression is global:
`opt_out`, `bounced`, `complained`, or *Do Not Contact* blocks every outreach
path and cancels pending follow-ups.

---

## Automation

Eight cron endpoints, each guarded by `CRON_SECRET` and driven by an external
scheduler (`vercel.json` declares no crons). See `CRON_SETUP.md`.

| Endpoint | Job |
|---|---|
| `cron/discover-leads` | Find new contractors |
| `cron/process-discovered-leads` | Scrape + score new leads |
| `cron/enrich-leads` | Fill missing contact data |
| `cron/automation` | Advance the outreach pipeline |
| `cron/send-daily-emails` | Send the day's queued batch |
| `cron/poll-replies` | Read and classify the inbox |
| `cron/process-followups` | Fire scheduled follow-ups |
| `cron/daily-digest` | Owner summary |

---

## Interface

Desktop sidebar, mobile bottom tab bar (`app/crm/_components/CrmNav.tsx`).

| Page | Purpose |
|---|---|
| `unified-dashboard` | Today's numbers and what needs action |
| `replies` | Inbound replies and their classification |
| `call-queue` | Leads to phone, with outcome logging |
| `bookings` | Scheduled meetings |
| `discovery` | Manual + auto lead scraping |
| `dm-queue` | **Research Center** — facts, weaknesses, sources, approval |
| `email-queue` | Outbound review and send |
| `onboarding` | Won-deal hand-off |
| `leads` | Full searchable table |
| `suppressed` | Opt-outs, bounces, complaints, DNC |
| `reports` | Funnel performance |

Theme: NY Jets palette — Gotham Green `#125740` primary (`brand`), Kelly Green
accent, Stealth Black, Streak White. Status colors stay distinct from the brand
so warnings and errors remain readable. Contrast is WCAG AA throughout.

---

## Cost Controls

- Google Places weekly cap, enforced in the DB before any HTTP call, with the
  reservation refunded when a request is rejected for credentials
  (`GOOGLE_PLACES_WEEKLY_CAP`, default 100 ≈ $3/week)
- OpenStreetMap as a free second discovery source
- Free/cheap AI tiers at the head of every provider chain
- Per-request timeouts and retry/backoff on every external call

---

## Key Files

| Path | Role |
|---|---|
| `middleware.ts` | Basic auth over the CRM and private APIs |
| `lib/ai-providers.ts` | Shared LLM layer, chains, retries |
| `lib/discovery-pipeline.ts` | Orchestrates a discovery run |
| `lib/discovery-sources.ts` | Google Places + Overpass, HVAC terms |
| `lib/hvac-signals.ts` | HVAC intelligence and sellable gaps |
| `lib/research-evidence.ts` | Facts with certainty grading |
| `lib/automation.ts` | Pipeline state machine |
| `lib/lead-stats.ts` | Single source of truth for KPIs |
| `lib/status-colors.ts` | Single source of truth for status colors |
| `lib/audit.ts` | Append-only change trail |
| `supabase/migrations/` | Schema history |
