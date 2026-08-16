-- ============================================================
-- Full Stack Services CRM — follow_up_tasks 'skipped' status (007)
-- Safe to run against an existing database.
-- ============================================================
--
-- app/api/cron/process-followups writes status 'cancelled' in three places
-- where it actually means "skipped" (lead opted out, lead has no email address,
-- or the 3-email cap is already reached). Its own inline comment flagged this:
--   "NOTE: schema CHECK has no 'skipped' value"
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
