# Insurance schema recovery

Insurance uses `INSURANCE_SUPABASE_URL` and its service role key, independently
of the CRM database. Apply SQL to that database; a Vercel deployment does not
apply Supabase migrations.

Migration 028 adds `insurance_email_outbox.send_limit` and refreshes PostgREST.
Migration 029 reconciles the standalone tables, RPCs, access restrictions and
indexes when migrations 018–024 were missing. It preserves records and saved
owner settings; new environments default to discovery and sending disabled.
Existing migration files are unchanged.

For an environment missing insurance tables, execute 029 explicitly first using
the Supabase SQL editor or `psql "$INSURANCE_DATABASE_URL" -v ON_ERROR_STOP=1
-f supabase/migrations/029_insurance_schema_reconciliation.sql`. Then replay the
missing historical migrations using your migration runner and apply 028–029.
This bootstrap is necessary because historical 022 references the standalone
outbox before 024 creates it; 025–028 also assume earlier tables exist. Do not
mark migrations applied without checking their SQL and the migration ledger.
Historical 020–021 also modify the shared CRM outbox and require the CRM base
schema; do not replay those files into an insurance-only database. In that case
use the standalone 029 reconciliation and reconcile the ledger separately.

For an already provisioned environment, apply pending 028 and 029 normally.
029 can be executed repeatedly without clearing data or enabling sending.

Verify all five pipeline tables and `send_limit`, then run
`scripts/insurance-language-database-test.sql` against a disposable test database
(it rolls back its fixtures). Run one authenticated insurance pipeline request
or the existing CRM Pipeline workflow with route `insurance-pipeline`; inspect
the response body as well as the HTTP status. A paused run does not verify send.
Confirm the `send_limit` schema-cache error is absent and inspect the latest
`automation_runs` and daily digest alert window before declaring alerts resolved.
