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
