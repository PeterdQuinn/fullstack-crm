-- ============================================================
-- Full Stack Services CRM — status_audit_log (002)
-- Additive only. Safe to run against an existing database.
-- Run in Supabase SQL editor (or `supabase db push`).
-- ============================================================
--
-- Append-only audit trail of lead status changes.
--
-- HISTORY. This table already exists in the live project — it was created by
-- hand and never committed, so `supabase/schema.sql` + `001_crm_fixes.sql`
-- alone produced a database WITHOUT it. lib/audit.ts swallows insert failures
-- by design ("auditing must never break the underlying operation"), so on a
-- fresh deploy every status change was silently dropped with no error anywhere.
--
-- COLUMN NAMES. The hand-made live table used (source, field_changed,
-- old_value, new_value). This file is now the canonical definition and uses
-- (changed_by, old_status, new_status, reason) instead. Because
-- `create table if not exists` is a NO-OP against the existing live table,
-- renaming it there is handled separately by
-- migrations/006_status_audit_log_rename.sql — run that one too.
-- lib/audit.ts writes the names below.

create table if not exists status_audit_log (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  old_status text,
  new_status text,
  -- 'owner'      = changed by the human operator through the CRM UI
  -- 'automation' = changed by cron / reply classifier / scoring / webhooks
  changed_by text not null default 'automation' check (changed_by in ('owner', 'automation')),
  changed_at timestamptz default now(),
  reason text,
  -- Which lead field changed. Defaults to 'status'; lib/audit.ts allows others,
  -- so this is kept rather than dropped — without it the table cannot represent
  -- the non-status audit rows the logStatusChange() `field` parameter emits.
  field_changed text not null default 'status'
);

-- Timeline reads ("what happened to this lead, newest first") are the primary
-- access pattern for the lead Activity tab.
create index if not exists idx_status_audit_log_lead_id on status_audit_log(lead_id);
create index if not exists idx_status_audit_log_changed_at on status_audit_log(changed_at desc);
create index if not exists idx_status_audit_log_lead_changed
  on status_audit_log(lead_id, changed_at desc);
-- NOTE: no index on changed_by here. Against the live database this file is a
-- no-op `create table if not exists` and the column is still named `source`, so
-- indexing changed_by would fail with 42703. 006 renames it and creates it.

alter table status_audit_log enable row level security;

-- NOTE: writes come from lib/audit.ts via the SERVICE-ROLE client, which
-- bypasses RLS entirely, so this policy does not gate the audit writer. It
-- governs the anon/browser key, which reaches this table only for reads.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'status_audit_log'
      and policyname = 'Allow all for authenticated'
  ) then
    create policy "Allow all for authenticated" on status_audit_log
      for all using (auth.role() = 'authenticated');
  end if;
end $$;
