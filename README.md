# Full Stack Services LLC — Internal Sales CRM

Internal outbound sales CRM. One link, one rep. Leads are **discovered automatically** (HVAC only) from Google Places + OpenStreetMap, AI-scored, emailed, and booked — with a manual call/DM workflow on top.

**Leads come from the Discovery pipeline, not a pre-loaded file.**

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

5. Also run every file in `supabase/migrations/` in order (001 → 014)
6. Restart `npm run dev` and open **/crm/discovery** to pull your first HVAC leads

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
| Scored | Scored below the outreach bar (50) |
| Ready for Outreach | Scored ≥ 50 — eligible for automated email |
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
accepted as a comma-separated rotation list. A manual **Run AI Research** action
uses Firecrawl Search and Map to collect dated BBB/licensing, reputation,
hiring, expansion, advertising, technology and website-footprint evidence.
Migration `014_internet_intelligence.sql` stores observations and the separate
0–100 footprint / -100–100 growth-momentum scores. Firecrawl failures degrade
to the existing deterministic website and Google signals rather than blocking
research.
