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
