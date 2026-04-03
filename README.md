# Full Stack Services LLC — Internal Sales CRM

Single-page internal outbound sales CRM dashboard. One link. One rep. Upload leads, call owners, follow a guided script, log everything, book meetings to Google Calendar.

**37 leads pre-loaded and ready to call.**

---

## Quick Start (Run Locally)

```bash
npm install
npm run dev
open http://localhost:3000
```

Works immediately in **Local Mode** — no database needed to start. All 37 leads are pre-loaded.

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

5. Restart `npm run dev` — the dashboard will auto-seed all 37 leads into Supabase

---

## Connect Google Calendar (Meeting Booking)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **Google Calendar API**
3. Create **OAuth 2.0 credentials** (Desktop app)
4. Use the [Google OAuth Playground](https://developers.google.com/oauthplayground/) to get a refresh token with `calendar.events` scope
5. Add to `.env.local`:

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
GOOGLE_CALENDAR_ID=primary
```

6. Now when the rep books a meeting, it appears on Peter Quinn's Google Calendar

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

| Status | Meaning |
|--------|---------|
| New | Not yet contacted |
| Called | Spoke with someone |
| No Answer | No pickup |
| Follow-Up | Scheduled callback |
| Interested | Warm lead |
| Booked | Meeting scheduled |
| Dead | Not interested |

### KPI Bar

Tracks total leads, new leads, called today, follow-ups due, booked meetings, and interested leads in real time.

---

## Import More Leads

Click **Import Leads** in the header. Upload any CSV with columns like `business_name`, `owner_name`, `phone`, `website`, `address`, `niche`. Duplicates are automatically skipped.

---

## Tech Stack

- **Next.js 14** — App Router
- **Supabase** — Postgres database
- **Google Calendar API** — Meeting booking
- **Tailwind CSS** — Styling
- **TypeScript** — Type safety
- **Vercel** — Deployment

---

## Pre-loaded Leads

**20 local Mesa/Gilbert/Tempe landscaping companies** with verified phone numbers.

**17 national landscaping companies** with known software (Jobber, Housecall Pro, Service Autopilot, LMN, Aspire, SingleOps, GorillaDesk, Real Green).

Total: **37 leads ready to call.**
