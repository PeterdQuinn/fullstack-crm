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
