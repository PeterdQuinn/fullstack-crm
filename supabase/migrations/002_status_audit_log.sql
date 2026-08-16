-- ============================================================
-- Full Stack Services CRM — status_audit_log (002)
-- Additive only. Safe to run against an existing database.
-- Run in Supabase SQL editor (or `supabase db push`).
-- ============================================================
--
-- BACKFILL MIGRATION. This table already exists in the live project — it was
-- created by hand and never committed, so `supabase/schema.sql` +
-- `001_crm_fixes.sql` alone produced a database WITHOUT it. lib/audit.ts
-- swallows insert failures by design ("auditing must never break the underlying
-- operation"), so on a fresh deploy every status change was silently dropped
-- with no error anywhere.
--
-- Column names below match the LIVE table exactly (verified against the running
-- project), so re-running this against production is a no-op rather than a
-- conflicting redefinition. Note the timestamp column is `changed_at`, NOT
-- `created_at`.
--
-- Written by lib/audit.ts -> logStatusChange():
--   lead_id, source, field_changed, old_value, new_value
-- `changed_at` is left to its default.

create table if not exists status_audit_log (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  -- 'owner'      = changed by the human operator through the CRM UI
  -- 'automation' = changed by cron / reply classifier / scoring / webhooks
  source text not null check (source in ('owner', 'automation')),
  -- Which lead field changed. Defaults to 'status'; lib/audit.ts allows others.
  field_changed text not null default 'status',
  old_value text,
  new_value text,
  changed_at timestamptz default now()
);

-- Timeline reads ("what happened to this lead, newest first") are the primary
-- access pattern for the lead Activity tab.
create index if not exists idx_status_audit_log_lead_id on status_audit_log(lead_id);
create index if not exists idx_status_audit_log_changed_at on status_audit_log(changed_at desc);
create index if not exists idx_status_audit_log_lead_changed
  on status_audit_log(lead_id, changed_at desc);
-- Supports the "what did automation do vs. the owner" split in reporting.
create index if not exists idx_status_audit_log_source on status_audit_log(source);

alter table status_audit_log enable row level security;

-- Matches the permissive policy style used by the rest of this schema. Writes
-- go through the service-role client in lib/audit.ts; the anon/browser key
-- reaches this table only via the /api/crm/log-status route.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'status_audit_log'
      and policyname = 'Allow all on status_audit_log'
  ) then
    create policy "Allow all on status_audit_log" on status_audit_log
      for all using (true) with check (true);
  end if;
end $$;
