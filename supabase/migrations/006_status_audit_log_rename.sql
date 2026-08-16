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
