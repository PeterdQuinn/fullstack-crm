

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
-- NOTE: the changed_by index is NOT created here. On the live database the
-- column is still named `source` at this point — it is renamed by the 006
-- section below, which creates this index afterwards.

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

-- ═══════════ 003_leads_status_constraint.sql ═══════════
-- ============================================================
-- Full Stack Services CRM — reconcile leads.status CHECK (003)
-- Safe to run against an existing database.
-- ============================================================
--
-- WHY THIS EXISTS
--
-- `supabase/schema.sql` declares a CHECK constraint on leads.status whose value
-- list is missing two statuses the application actually writes:
--
--   'Needs Follow-Up'  <- lib/reply-actions.ts, the "unclear reply" branch
--   'Scored'           <- app/api/cron/process-discovered-leads, below-threshold
--
-- The LIVE database has NO status CHECK constraint at all (verified directly:
-- an arbitrary garbage status inserts successfully), so production is not
-- currently broken by this. The defect is schema drift: anyone deploying from
-- this repo gets the strict constraint, and both code paths above then fail.
--
-- This migration makes the constraint match what the code actually writes, and
-- reinstates it on the live database where it is currently absent. That closes
-- the drift in both directions instead of only one.
--
-- The list below is the union of:
--   * every value in the original schema.sql constraint, and
--   * every status literal written anywhere in app/ or lib/.
-- Duplicates in the original list ('Called', 'Interested', 'Booked') are
-- collapsed.

alter table leads drop constraint if exists leads_status_check;

alter table leads add constraint leads_status_check check (status in (
  -- Pre-outreach / discovery
  'New',
  'Needs Data',
  'Bad Data',
  'Ready for AI Summary',
  'Scored',
  'Ready for Outreach',
  -- Email sequence
  'Email 1 Sent',
  'Email 2 Sent',
  'Email 3 Sent',
  'Bad Email',
  -- DM sequence
  'DM Needed',
  'DM Sent',
  -- Calling
  'Call Needed',
  'Called',
  'No Answer',
  -- Follow-up
  'Follow-Up',
  'Follow-Up Scheduled',
  'Needs Follow-Up',
  -- Reply handling / booking
  'Replied',
  'Interested',
  'Booking Link Sent',
  'Booked',
  -- Post-booking
  'Onboarding Sent',
  'Onboarding Completed',
  -- Terminal
  'Won',
  'Lost',
  'Dead',
  'No Response',
  'Do Not Contact'
));

-- Guard against the constraint failing to apply because of pre-existing rows
-- written while no constraint was enforced. If this migration errors with
-- "check constraint is violated by some row", run this first to find them:
--
--   select distinct status, count(*) from leads group by status order by 2 desc;
--
-- and reconcile those rows before re-running.

-- ═══════════ 004_status_audit_log_cascade.sql ═══════════
-- ============================================================
-- Full Stack Services CRM — status_audit_log FK cascade (004)
-- Safe to run against an existing database. DO NOT run blind in prod
-- without reading the note below.
-- ============================================================
--
-- FOUND BY A LIVE PROBE, 2026-08-15:
--
--   insert lead -> insert status_audit_log row -> DELETE the lead
--   => HTTP 409 Conflict, lead NOT deleted.
--
-- The live `status_audit_log` table was created by hand (see 002) and its
-- foreign key to `leads` was created WITHOUT `on delete cascade`. Every other
-- child table cascades correctly — the same probe against `outreach_log` and
-- `lead_ai_summaries` deleted cleanly.
--
-- WHY IT MATTERS
--
-- Any lead that has ever had a status change now has an audit row, so:
--
--   * Deleting a lead from the CRM UI (app/crm/leads/page.tsx) silently fails.
--     That path deletes call_logs, lead_notes, appointments and outreach_log
--     first, but not status_audit_log, then deletes the lead and ignores the
--     result — so the row stays and the UI reports success.
--
--   * The scoring phase's hard-delete (lib/automation.ts) is mostly unaffected
--     today, because a below-threshold lead is deleted BEFORE any status change
--     is logged for it. It becomes affected the moment a lead is deleted after
--     reaching a logged status.
--
-- Migration 002 declares the FK correctly for a fresh install, but it is a
-- `create table if not exists`, so it is a no-op against the live table and
-- does NOT repair the existing constraint. This migration does.
--
-- NOTE ON ORDER: run 002 first (it is a no-op on live), then this.

do $$
declare
  fk_name text;
begin
  -- Find the FK on status_audit_log.lead_id regardless of what it was named.
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'status_audit_log'
    and con.contype = 'f'
    and con.conkey = array[
      (select attnum from pg_attribute
        where attrelid = rel.oid and attname = 'lead_id')
    ]::smallint[]
  limit 1;

  if fk_name is not null then
    execute format('alter table public.status_audit_log drop constraint %I', fk_name);
  end if;

  alter table public.status_audit_log
    add constraint status_audit_log_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete cascade;
end $$;

-- Verify (should print one row with confdeltype = 'c' for CASCADE):
--
--   select con.conname, con.confdeltype
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   where rel.relname = 'status_audit_log' and con.contype = 'f';

-- ═══════════ 005_leads_missing_columns.sql ═══════════
-- ============================================================
-- Full Stack Services CRM — reconcile leads columns (005)
-- Additive only. Safe to run against an existing database.
-- ============================================================
--
-- WHY THIS EXISTS
--
-- Twelve columns existed in the LIVE `leads` table but were absent from
-- `supabase/schema.sql` (verified by reading a live row on 2026-08-15). Because
-- schema.sql uses `create table if not exists`, adding them there fixes only
-- brand-new databases; this migration brings already-deployed ones in line.
--
-- The drift was not cosmetic: lib/reply-actions.ts writes `calendly_link_sent`
-- on the "interested" branch. That column exists in prod, so the autonomous
-- booking path works there — but any database built from schema.sql alone would
-- reject the update, and because the call does not check its error result, the
-- status change would have failed SILENTLY while the function still reported
-- success.

alter table leads add column if not exists calendly_link_sent boolean default false;
alter table leads add column if not exists assigned_to text;
alter table leads add column if not exists priority text;
alter table leads add column if not exists source text;
alter table leads add column if not exists tags text[];
alter table leads add column if not exists transcript text;
alter table leads add column if not exists zip text;
alter table leads add column if not exists pain_point text;
alter table leads add column if not exists google_rating numeric;
alter table leads add column if not exists google_review_count integer;
alter table leads add column if not exists employee_count integer;
alter table leads add column if not exists how_they_get_clients text;

-- Verify (should return 12 rows):
--
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'leads'
--     and column_name in (
--       'calendly_link_sent','assigned_to','priority','source','tags',
--       'transcript','zip','pain_point','google_rating','google_review_count',
--       'employee_count','how_they_get_clients')
--   order by column_name;

-- ═══════════ 006_status_audit_log_rename.sql ═══════════
-- ============================================================
-- Full Stack Services CRM — status_audit_log column rename (006)
-- Safe to run against an existing database. Idempotent.
-- ============================================================
--
-- Migration 002 is the canonical definition of status_audit_log, but it is a
-- `create table if not exists`, so it is a NO-OP against the hand-created live
-- table, which still carries the old column names:
--
--   source        -> changed_by
--   old_value     -> old_status
--   new_value     -> new_status
--   (missing)     -> reason
--
-- lib/audit.ts writes the NEW names, so without this migration every audit
-- insert against the live database fails — and because lib/audit.ts swallows
-- insert errors by design, it fails SILENTLY. Run this immediately after 002.
--
-- The live table had 0 rows when this was written, so the rename cannot lose
-- data; it is written as a rename rather than a drop/recreate so it stays
-- correct if rows have since been added.

do $$
begin
  if to_regclass('public.status_audit_log') is null then
    -- Fresh database: 002 already created the table in its final shape.
    return;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'status_audit_log'
               and column_name = 'source') then
    alter table public.status_audit_log rename column source to changed_by;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'status_audit_log'
               and column_name = 'old_value') then
    alter table public.status_audit_log rename column old_value to old_status;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'status_audit_log'
               and column_name = 'new_value') then
    alter table public.status_audit_log rename column new_value to new_status;
  end if;

  alter table public.status_audit_log add column if not exists reason text;
  alter table public.status_audit_log add column if not exists field_changed text not null default 'status';
end $$;

-- The live table already HAD field_changed (not null, no default), so the
-- `add column if not exists` above was a no-op there and never applied the
-- default. lib/audit.ts always sends the column explicitly, so nothing is
-- broken today — but any insert that omits it fails with 23502 instead of
-- defaulting to 'status'. Set it unconditionally so live matches 002.
alter table public.status_audit_log alter column field_changed set default 'status';

-- The old table's CHECK was named after the old column; re-point it so
-- 'owner'/'automation' stays enforced under the new name.
alter table public.status_audit_log drop constraint if exists status_audit_log_source_check;
alter table public.status_audit_log drop constraint if exists status_audit_log_changed_by_check;
alter table public.status_audit_log
  add constraint status_audit_log_changed_by_check
  check (changed_by in ('owner', 'automation'));

create index if not exists idx_status_audit_log_changed_by on status_audit_log(changed_by);
drop index if exists idx_status_audit_log_source;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'status_audit_log' order by ordinal_position;

-- ═══════════ 007_follow_up_tasks_skipped.sql ═══════════
-- ============================================================
-- Full Stack Services CRM — follow_up_tasks 'skipped' status (007)
-- Safe to run against an existing database.
-- ============================================================
--
-- app/api/cron/process-followups writes status 'cancelled' in three places
-- where it actually means "skipped" (lead opted out, lead has no email address,
-- or the 3-email cap is already reached). Its own inline comment flagged this:
--   "NOTE: schema CHECK has no 'skipped' value"take 
--
-- Conflating the two is a real reporting defect — a task deliberately cancelled
-- and a task skipped because the lead had no email are indistinguishable, so
-- "why did this lead never get its follow-up?" is unanswerable from the data.
--
-- NOTE ON `status` SEMANTICS: this column is the TASK's lifecycle state, not
-- the LEAD's pipeline status. It must stay within this small set — writing a
-- lead status such as 'Follow-Up Scheduled' here would violate this constraint
-- and abort the update. The lead's own status is tracked separately on
-- `leads.status`, and process-followups leaves it untouched when it skips, so
-- the lead remains in the follow-up queue exactly as intended.

alter table follow_up_tasks drop constraint if exists follow_up_tasks_status_check;

alter table follow_up_tasks add constraint follow_up_tasks_status_check check (
  status in (
    'pending',    -- due or upcoming, not yet acted on
    'completed',  -- the follow-up email was sent
    'skipped',    -- intentionally not sent (opted out / no email / cap reached)
    'cancelled'   -- withdrawn for any other reason
  )
);

-- ═══════════ 008_leads_soft_archive.sql ═══════════
-- ============================================================
-- Full Stack Services CRM — soft archive for leads (008)
-- Additive only. Safe to run against an existing database.
-- ============================================================
--
-- WHY THIS EXISTS
--
-- lib/automation.ts previously HARD-DELETED two classes of lead during the
-- scoring phase:
--
--   1. leads that failed the data-completeness gate (never scored at all)
--   2. leads a real provider scored below SCORE_KEEP_THRESHOLD
--
-- With 357 live leads and a daily cron, a single bad scoring run could destroy
-- the pipeline irrecoverably — `delete` on `leads` cascades to call_logs,
-- lead_notes, appointments, outreach_log, lead_ai_summaries, lead_socials and
-- status_audit_log, so the audit trail of the deletion is destroyed along with
-- the lead. There is no undo.
--
-- Deletion is now a soft archive by default. Rows are retained, stamped, and
-- filtered out of every candidate query. Hard deletion still exists but is
-- gated behind ALLOW_LEAD_DELETION=true, which defaults to OFF.

alter table leads add column if not exists archived_at timestamptz;
alter table leads add column if not exists archive_reason text;

-- Every candidate query filters on `archived_at is null`, so this partial index
-- keeps those scans cheap as the archive grows.
create index if not exists idx_leads_archived_at on leads(archived_at);
create index if not exists idx_leads_active on leads(created_at) where archived_at is null;

-- Restore an archived lead:
--   update leads set archived_at = null, archive_reason = null where id = '...';
--
-- Review what the pipeline archived and why:
--   select archive_reason, count(*) from leads
--   where archived_at is not null group by archive_reason order by 2 desc;

-- ═══════════ 010_research_evidence.sql ═══════════

create table if not exists lead_research_facts (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  field_name text not null,
  label text not null,
  field_value text,
  certainty text not null check (certainty in ('verified', 'single_source', 'ai_inference', 'not_found')),
  source_label text,
  source_url text,
  source_count integer not null default 0,
  researched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lead_id, field_name)
);

create index if not exists idx_lead_research_facts_lead_id on lead_research_facts(lead_id);
alter table lead_research_facts enable row level security;
drop policy if exists "Allow all on lead_research_facts" on public.lead_research_facts;
drop policy if exists "Open access lead_research_facts" on public.lead_research_facts;

drop trigger if exists lead_research_facts_updated_at on lead_research_facts;
create trigger lead_research_facts_updated_at
  before update on lead_research_facts
  for each row execute function update_updated_at();
