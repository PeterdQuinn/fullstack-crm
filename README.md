# Full Stack Services LLC — Internal Sales CRM

Internal outbound sales CRM that runs itself. Leads are **discovered
automatically** from Google Places + OpenStreetMap across whatever niches and
cities you save, then enriched, researched, AI-scored, emailed on a three-touch
sequence, and booked when they reply — with a manual call/DM workflow on top.

**Leads come from the Discovery pipeline, not a pre-loaded file.**

**There are two pipelines.** HVAC and trades runs from `/crm/automation`.
Insurance — producer recruiting and buyer research across AZ, SC, VA, OH and MI
— runs the same five stages from `/crm/insurance` behind its own three switches.
They share one database and one daily sending budget, and nothing else.

While a pipeline's switch is off, nothing is discovered, scored, or sent. While
it is on, the schedule in `ARCHITECTURE.md` runs without you.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for how the pipeline, the outbox, the
AI provider chains and the data model actually fit together.

---

## Quick Start (Run Locally)

```bash
npm install
npm run dev
open http://localhost:3000
```

Supabase is required — lead discovery, scoring and outreach all read and write the database.

---

## Connect Supabase (Persistent Data)

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and paste the contents of `supabase/schema.sql` — run it
3. Go to **Settings > API** and copy your URL and anon key
4. Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

5. Also run every file in `supabase/migrations/` in order (001 → 021)
6. Restart `npm run dev`, open **/crm/automation** to set your niches and cities,
   then **/crm/discovery** to pull your first leads

### Environment variables that matter

| Variable | Why |
|----------|-----|
| `SUPABASE_SERVICE_ROLE_KEY` | Every server route. Never exposed to the browser. |
| `CRON_SECRET` | Guards every `/api/cron/*` verb **and** `/api/scrape-phone`, which the enrichment stages call over HTTP |
| `APP_USERNAME` / `APP_PASSWORD` | The CRM login. Make the password long and random — the per-IP brake slows a brute force, it does not stop one. |
| `SESSION_SECRET` | Signs the session cookie. Without it the key is derived from `APP_PASSWORD` + `CRON_SECRET`, and `CRON_SECRET` lives in GitHub Actions. |
| `COMPANY_MAILING_ADDRESS` | CAN-SPAM. **No email sends at all until this is a real street address or PO box.** |
| `DAILY_SEND_CAP` | Default 40, shared across both pipelines |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` | Sending and delivery events |
| `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_MAILBOX` | Reading replies from Outlook |
| `SERPAPI_API_KEY` / `PRODUCERFORGE_OLLAMA_API_KEY` | Insurance search (100 requests/month each) |
| `INSURANCE_FROM_EMAIL` / `INSURANCE_MAILING_ADDRESS` | Optional — insurance mail defaults to the company's sender and address |

Production values live in Vercel, not here. `vercel env pull` refreshes a stale
local `.env.local`; a local key that has drifted will 401 while production works
fine.

---

## Meeting Booking (Calendly)

Booking runs through a single Calendly link — no Google Calendar OAuth, no
refresh tokens, no custom free/busy code. Calendly is already connected to the
owner's calendar, so it creates the event on both sides itself.

The link lives in `lib/reply-actions.ts`:

```ts
export const CALENDLY_LINK =
  "https://calendly.com/fullstackservicesllc/full-stack-meeting";
```

When a reply is classified **Interested**, the CRM automatically emails that
link and moves the lead to `Booking Link Sent`. To change the link, edit that
constant.

---

## Deploy to Vercel

```bash
git init && git add . && git commit -m "CRM"
git remote add origin https://github.com/PeterdQuinn/fullstack-crm.git
git push -u origin main
```

Then go to [vercel.com/new](https://vercel.com/new), import the repo, add your env vars, deploy.

---

## How It Works

### For the Rep

1. Open the dashboard link
2. Click a lead from the table
3. Hit the **Call** button (dials on mobile)
4. Follow the **guided discovery questions** in the Details tab
5. Switch to **Call Log** tab → log the outcome, notes, pain points, what software they use
6. Switch to **Meeting** tab → book a meeting with Peter Quinn
7. Move to the next lead

### Lead Statuses

29 statuses are permitted — see the `leads_status_check` constraint in
`supabase/schema.sql` and the `LeadStatus` union in `lib/types.ts` (they must
stay in sync). The main path:

| Status | Meaning |
|--------|---------|
| New | Discovered, not yet scored |
| Scored | Scored below the outreach bar (20), or holding a placeholder 50 awaiting re-score |
| Ready for Outreach | Scored ≥ 20 (never exactly 50) — eligible for automated email |
| Email 1/2/3 Sent | Position in the 3-touch sequence |
| Replied | Reply received, awaiting classification |
| Booking Link Sent | Classified Interested — Calendly link emailed |
| Booked | Meeting on the calendar |
| Follow-Up Scheduled | Unclear reply — follow-up task queued |
| Do Not Contact | Opted out, complained, or classified Not Interested |
| Bad Email | Hard bounce |

### KPI Bar

Tracks total leads, new leads, called today, follow-ups due, booked meetings, and interested leads in real time.

---

## Getting Leads

**Discovery (primary).** `/crm/discovery` runs the HVAC pipeline: Google Places
(hard-capped at 20 requests/week, enforced in the database) + OpenStreetMap
Overpass (free), AI-deduplicated, then imported. Search terms and target metros
live in `lib/discovery-sources.ts`.

**CSV import (secondary).** Click **Import Leads** in the header. Any CSV with
`business_name`, `owner_name`, `phone`, `website`, `address`, `niche`.
Duplicates are skipped.

---

## Insurance Workspace

`/crm/insurance` is the second pipeline's control room. Three switches, all off
by default:

| Switch | What it starts |
|--------|----------------|
| `enabled` | Scheduled discovery, enrichment and qualification. Nothing leaves the building. |
| `sending_enabled` | Real email, up to three touches, capped with the HVAC pipeline at one shared daily budget. |
| `autopilot` | A reply classified "not interested" suppresses the record without you. That is the only automated action. |

Before turning sending on, open a record and hit **Preview the next touch** —
that is exactly what a stranger receives.

Discovery only imports sources that can become a lead: quote farms, listicles
and job boards are refused, carriers are refused for buyers but kept for
recruiting (a captive agent is a recruiting target). Enrichment looks for a
phone as well as an address, and the board says how each record can be worked —
email, call, or not reachable yet. Records that turn out to be the same person
are merged on a matching email, or on a matching phone *and* name; a shared
office number alone never merges two people.

Verify with `npm run test:insurance`.

## Tech Stack

- **Next.js 14** — App Router
- **Supabase** — Postgres database
- **Calendly** — Meeting booking
- **Resend** — Outbound email + delivery/bounce webhooks
- **Google Places + OSM Overpass** — Lead discovery
- **Tailwind CSS** — Styling
- **TypeScript** — Type safety
- **Vercel** — Deployment

---

## Tests

```bash
npm test              # 7 suites: reply policy, automation contract, AI
                      # normalisation, cron workflow, database retry,
                      # insurance, email extraction
npm run ai:health     # probes every AI provider with real calls
npm run verify:live   # exercises the deployed routes
```

The automation contract test reads the source and asserts the properties that
have broken before — 207 checks — so a regression fails the build instead of the
pipeline.

## AI Providers

Every AI task (reply classification, lead scoring, email drafting, discovery
cleanup) runs through one ordered fallback chain defined in
`lib/ai-providers.ts`:

**Ollama → Groq → Gemini → Anthropic → Kablewy**

A provider with no API key is skipped rather than failing the chain. Order is
overridable per task via `CLASSIFIER_PROVIDERS`, `SCORING_PROVIDERS`,
`DRAFT_PROVIDERS`, `CLEANUP_PROVIDERS`.

Check them with `npm run ai:health`.

## Internet Intelligence (Firecrawl)

Set `FIRECRAWL_API_KEY` in the server environment. `FIRECRAWL_API_KEYS` is also
accepted as a comma-separated rotation list, and the legacy spelling
`FIRE_CRAWL_API_KEY` is supported. A manual **Run AI Research** action
uses Firecrawl Search and Map to collect dated BBB/licensing, reputation,
hiring, expansion, advertising, technology and website-footprint evidence.
Migration `014_internet_intelligence.sql` stores observations and the separate
0–100 footprint / -100–100 growth-momentum scores. Firecrawl failures degrade
to the existing deterministic website and Google signals rather than blocking
research.
