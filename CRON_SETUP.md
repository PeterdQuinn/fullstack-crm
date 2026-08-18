# Automated Cron Job Setup

This guide explains how to set up automated cron jobs for the CRM system.

## Available Cron Endpoints

### 1. Process Discovered Leads (Scrape & Score)
**Endpoint**: `POST /api/cron/process-discovered-leads`

**What it does:**
- Takes new leads (status="New") that haven't been scored
- Scrapes their websites for missing emails, phones, and owner names
- Scores each lead through the AI provider chain
  (Ollama → Groq → Gemini → Anthropic → Kablewy, see `lib/ai-providers.ts`)
- Updates lead status to "Ready for Outreach" if score ≥ 50, otherwise "Scored"

**Recommended frequency**: Every 2-3 hours
**Timeout**: 5 minutes (300 seconds)

**Example cURL**:
```bash
curl -X GET "https://yourapp.com/api/cron/process-discovered-leads" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 2. Send Daily Emails
The old `send-daily-emails` endpoint is disabled. Outbound email runs through the weekly automation workflow.

**What it does:**
- Sends up to 25 emails per day to high-quality leads
- Respects the 25-email-per-day cap
- Sends 3 follow-up emails per lead (at most)
- Uses AI-generated personalized messages
- Logs all sent emails to outreach_log

**Recommended frequency**: Once per day (morning is best)
**Timeout**: 2 minutes (120 seconds)

**Example cURL**:
```bash
curl -X GET "https://yourapp.com/api/cron/send-daily-emails" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Setup Instructions

### Option 1: Using Vercel Cron (Recommended for Vercel deployments)

Crons are declared in `vercel.json` at the repo root (NOT `.vercel/crons.json`):

```json
{
  "crons": [
    { "path": "/api/cron/automation", "schedule": "0 9 * * *" }
  ]
}
```

**Vercel Cron sends GET requests.** Any route it targets must export a `GET`
handler — a POST-only route returns 405 on every scheduled run and the job
silently never executes. `/api/cron/automation` now exports both.

Vercel also injects `Authorization: Bearer $CRON_SECRET` automatically when
`CRON_SECRET` is set on the project.

### Option 2: Using EasyCron.com (Free)

1. Go to https://www.easycron.com
2. Create new cron job:
   - URL: `https://yourapp.com/api/cron/process-discovered-leads`
   - Cron Expression: `0 */2 * * *` (every 2 hours)
   - HTTP Authorization: Add header `Authorization: Bearer YOUR_CRON_SECRET`
3. Repeat for second endpoint with `0 9 * * *` (9 AM daily)

### Option 3: Using AWS EventBridge

Set up Lambda functions that invoke your endpoints on schedule.

### Option 4: Using External Cron Service (cron-job.org, etc.)

1. Register at https://cron-job.org/
2. Create job:
   - URL: `https://yourapp.com/api/cron/process-discovered-leads`
   - Method: GET
   - Headers: `Authorization: Bearer YOUR_CRON_SECRET`
   - Cron: `0 */2 * * *`

## Configuration

### Set CRON_SECRET Environment Variable

Add to your `.env.local`:
```
CRON_SECRET=your-secure-random-string-here
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

### Verify Setup

Check the cron setup by visiting:
```
https://yourapp.com/api/cron/process-discovered-leads?authorization=Bearer%20YOUR_CRON_SECRET
```

## Cron Schedule Reference

- `0 */2 * * *` = Every 2 hours
- `0 */3 * * *` = Every 3 hours
- `0 9 * * *` = 9:00 AM daily
- `0 8-17 * * *` = Every hour 8 AM - 5 PM
- `*/15 * * * *` = Every 15 minutes

## Monitoring

### Check logs
Each cron job logs to your application logs with timestamps:
- `🔄 Starting discovered leads processor...`
- `📧 Starting daily email send...`

### Manual Testing

To manually trigger cron jobs for testing:

```bash
# Test discovered leads processor
curl -X GET "http://localhost:3000/api/cron/process-discovered-leads"

# Test email sender
curl -X GET "http://localhost:3000/api/cron/send-daily-emails"
```

## Troubleshooting

**Problem**: Cron job not running
- Check that CRON_SECRET is set correctly
- Verify endpoint URL is correct
- Check application logs for errors

**Problem**: Emails not being sent
- Verify Resend API key is set
- Check that leads have email addresses
- Check email_sent_count hasn't exceeded 3

**Problem**: Leads not being scored
- Run `npm run ai:health` — it fires one real call per provider per chain
- Verify at least one provider key is set: `OLLAMA_API_KEY`, `Groq_API_KEY`,
  `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `KABLEWY_API`
- A chain whose providers all lack keys logs
  "AI chain is empty — no configured provider has an API key set"
- Scores of exactly 50 tagged `provider: "fallback"` mean EVERY provider failed;
  such leads are never deleted, and are re-scored on the next run

**Problem**: Scraping failing
- Check website URLs are valid
- Verify website is publicly accessible
- Check for rate limiting from target sites

## Daily Workflow

1. **9:00 AM** (Vercel): `/api/cron/automation` — scrape → score → send, daily
2. **Every 2-3 hours** (external): `/api/cron/enrich-leads` — fills email/socials
3. **Daily** (external): `/api/cron/process-followups` — sends touches 2 and 3
4. **Daily** (external): `/api/cron/daily-digest` — owner summary email

The automation cron's send phase only emails leads at `Ready for Outreach` or
`Follow-Up Scheduled`, and hands touches 2/3 to `process-followups` by queuing a
`follow_up_tasks` row. That is what stops a booked lead receiving a cold email.
