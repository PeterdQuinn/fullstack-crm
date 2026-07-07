-- ============================================================
-- Full Stack Services CRM — Fixes migration (001)
-- Additive only. Safe to run against an existing database.
-- Run in Supabase SQL editor (or `supabase db push`).
-- ============================================================

-- FIX 4 — Cron failure log.
-- One row per failed automation phase, written by /api/cron/automation.
create table if not exists cron_failures (
  id uuid default gen_random_uuid() primary key,
  phase text not null,               -- 'scrape' | 'score' | 'send'
  error_message text,
  created_at timestamptz default now()
);

create index if not exists idx_cron_failures_created_at on cron_failures(created_at);

alter table cron_failures enable row level security;
create policy "Allow all on cron_failures" on cron_failures for all using (true) with check (true);

-- FIX 2 — Preserve the lead's pipeline status at the moment it was suppressed
-- (bounced / complained / opt_out), so the Suppressed view can show where the
-- lead was before it was pulled from outreach.
alter table leads add column if not exists status_before_suppression text;

-- FIX 7 — Consent / legal basis for contacting a lead. Set automatically when a
-- lead is first added via Discovery.
alter table leads add column if not exists contact_basis text;
alter table leads add column if not exists contact_basis_logged_at timestamptz;
