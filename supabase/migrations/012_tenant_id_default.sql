-- ─────────────────────────────────────────────────────────────────────────────
-- URGENT FIX for 011_multi_tenant.sql.
--
-- 011 added `tenant_id NOT NULL` to twelve tables. Reads kept working, because
-- the service role bypasses RLS -- which is what was verified after applying it.
-- WRITES did not, and that was not checked: every INSERT in the app omits
-- tenant_id, so all of them now fail with 23502 (not_null_violation).
--
-- Observed within minutes of applying 011:
--   scripts/batch-score.mjs      10/10 inserts into lead_ai_summaries failed
--   any status change            status_audit_log insert fails
--   sending an outreach email    Resend accepts the message, THEN the
--                                outreach_log insert throws -- so the prospect
--                                is mailed and the CRM has no record of it,
--                                the daily cap loses its counter, and no
--                                follow-up is ever scheduled
--
-- The real fix is migrating all 38 routes to tenantScope() (Phase 1, Batch 1-6
-- in TODO.md). That is days of work. This makes the database correct for the
-- single-tenant reality of today so nothing is broken while that proceeds:
-- every legacy INSERT lands on the founding tenant, exactly where it belongs.
--
-- This is NOT a workaround to leave in place once tenants are real. A default
-- means a route that forgets its tenant silently writes into the founding
-- tenant instead of failing loudly. Drop the defaults at the end of the route
-- migration -- there is a DROP block at the bottom, commented out, for that.
-- ─────────────────────────────────────────────────────────────────────────────

-- DEFAULT cannot contain a subquery, but it can call a function.
-- STABLE, not IMMUTABLE: the answer depends on table contents.
create or replace function founding_tenant_id() returns uuid
language sql
stable
as $$ select id from tenants where is_founding limit 1 $$;

do $$
declare t text;
begin
  foreach t in array array[
    'leads','lead_ai_summaries','lead_socials','lead_research_facts',
    'status_audit_log','follow_up_tasks','outreach_log','appointments',
    'call_logs','lead_notes','cron_failures','lead_discovery_config'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'alter table public.%I alter column tenant_id set default founding_tenant_id()', t);
    end if;
  end loop;
end $$;

-- Belt and braces: if the founding tenant were ever missing, the default would
-- evaluate to NULL and the NOT NULL constraint would fail loudly rather than
-- writing an unattributed row. That is the correct failure mode -- do not
-- "fix" it by dropping the NOT NULL.

-- ── AFTER the route migration is complete (Phase 1, Batch 1-6) ──────────────
-- Re-run this block to remove the safety net, so a route that forgets its
-- tenant fails instead of silently writing into the founding tenant.
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'leads','lead_ai_summaries','lead_socials','lead_research_facts',
--     'status_audit_log','follow_up_tasks','outreach_log','appointments',
--     'call_logs','lead_notes','cron_failures','lead_discovery_config'
--   ] loop
--     if to_regclass('public.' || t) is not null then
--       execute format('alter table public.%I alter column tenant_id drop default', t);
--     end if;
--   end loop;
-- end $$;
