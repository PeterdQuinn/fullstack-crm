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
