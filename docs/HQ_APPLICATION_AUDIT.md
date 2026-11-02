# Full Stack HQ: application inventory and integration decisions

The latest hierarchy and implementation plan is [HQ_WORKSPACE_REFACTOR.md](HQ_WORKSPACE_REFACTOR.md): two workspaces, with HVAC nested under Full Stack.

## Delivery boundary

Audit date: 2026-11-01 (Phoenix). Local baseline is
`e172d7bf12a49cc56342d1a25846e7aeca2abdf0`, parent `45bc03d`.
`main` and `preservation/insurance-schema-repair` preserve the repair. HQ work
belongs on `feat/full-stack-hq`, in a separate commit. A local Git bundle also
preserves the original history. Shell DNS cannot resolve GitHub; the connected
GitHub app rejects Git tree writes and Actions reruns with HTTP 403. Phase 1
production delivery, deployment and pipeline verification remain blocked.
Do not describe local success as a production deployment.

## Evidence and limits

Inspected HQ source, routes, session middleware, SQL migrations, insurance
clients and workflow. GitHub API confirms `PeterdQuinn/fullstack-crm` is the
repository. The Vercel dashboard URLs supplied by Peter are management links,
not production application URLs. They were inaccessible to the web reader.
GitHub repository lookups for `PeterdQuinn/peter-insurance` and
`PeterdQuinn/hvac-2026` returned 404; installed-repository searches for insurance
and HVAC found no accessible repositories. A Vercel project name does not
establish its repository name. Their source audits are blocked, not complete.
No code or database changes are authorized by this inventory in those apps.

| Area | Full Stack HQ / fullstack-crm | peter-insurance | hvac-2026 |
| --- | --- | --- | --- |
| Source | Verified local tree and GitHub main | Repository mapping/access needed | Repository mapping/access needed |
| Auth | APP_USERNAME/APP_PASSWORD; Basic Auth or signed HttpOnly fscrm_session cookie; signed workspace cookie | Unverified | Unverified |
| Database | FSS: NEXT_PUBLIC_SUPABASE_URL + server service role; insurance: INSURANCE_SUPABASE_URL + separate service role | Project ID, database and credentials boundary unverified | Database/Supabase project unverified |
| Customers/jobs | CRM leads, calls, notes, appointments, outreach and follow-up tasks; no verified field-service job model | Unverified | Customer/job model unverified |
| Scheduling | Appointment/calendar API, bookings and follow-ups | Unverified | Scheduling/dispatch unverified |
| Revenue | Lead booking/onboarding stages; no verified deal amount/invoice ledger | Unverified | Invoicing/payments unverified |
| Dashboards | CRM unified dashboard, reports, automation and insurance board | Unverified | Unverified |
| APIs/automation | CRM CRUD/queues; insurance research/scoring/outreach; signed Resend webhooks; CRON_SECRET routes via GitHub Actions | Unverified | Unverified |
| Integration now | Central shell; preserve all working module routes | Register management link; no guessed production URL | Register management link; no guessed production URL |

Supabase instance identifiers and deployed environment values are unavailable
locally; do not infer them from comments or expose credentials in the registry.
Migration 011 contains tenants/tenant_members and owner/admin/operator roles,
but the current operator login does not issue Supabase user JWTs. Most server
routes use a service role, so database RLS does not scope those requests to a
future non-owner identity. Multi-user access requires an explicit server-side
permissions and tenant-isolation review first.

## Insurance feature classification

The following is verified in HQ; the external application's A–D classification
is pending access and must not be guessed from its name.

| Class | Verified HQ functionality | Decision for external insurance app |
| --- | --- | --- |
| A: public marketing/funnels | HQ has a public marketing landing page | Keep external public acquisition/funnels separate if found; confirm routes/domains first |
| B: authenticated operations | Prospects, recruiting queue, research, language/fit evidence, activities, tasks, settings and standalone outbox | HQ is the operational pipeline; review any unique external workflows before connecting |
| C: duplicated CRM | Existing /crm/insurance page is reused by /insurance routes | Reuse this implementation; do not create another prospect board |
| D: reusable services | Insurance DB client, scoring, fit/language research, outreach, email and AI patterns | Inventory matching external code before selecting a shared service |

HQ currently reads legacy ProducerForge `workspace_state.producers` as a
fallback when insurance_prospects is empty; this is evidence of a compatibility
path, not proof that the external Vercel app uses the same database. Insurance
pipeline run logging is written to FSS automation_runs by withAutomationRun;
the insurance workspace separately queries its insurance DB for runs. The HQ
summary should read FSS for run status, not assume that second location exists.

## HVAC audit checklist and decision

All external HVAC source details remain unverified: authentication/provider,
database and tenant model, customers, jobs/work orders, scheduling, dispatch,
invoicing, dashboards, automation, APIs and shared UI. Obtain its repository
URL and deployment mapping, inspect auth middleware/schema/API contracts, and
record evidence per route before exposing customer data in HQ. CRM trade lead
outreach is not the HVAC application's job activity and must not be labelled
as such. Phase 2 provides a registered launch surface and integration status.
Phase 3 should add a read-only, least-privilege API adapter after that audit.
Leave its production database and app in place.

## Keep, move, link, share

- Keep the three deployments and their databases. Keep HQ's public landing,
  CRM routes, insurance board and existing cron/webhook protection.
- Move navigation and cross-system attention summaries into HQ, not entire apps.
- Link external apps only when verified production URLs are registered. Until
  then link their known Vercel management projects and mark launch unavailable.
- Share auth first after a security review; then UI primitives/config, email
  transport and idempotency, AI provider access/budgets, logging/analytics,
  task/notification contracts and server-only DB client factories. Do not share
  business schemas or service-role credentials across browser apps.
- Projects and HVAC activity remain explicit disconnected states until a real
  source is integrated; do not invent projects, counts or revenue totals.

## Existing page route inventory (before HQ work)

- `/crm/automation`
- `/crm/bookings`
- `/crm/call-queue`
- `/crm/discovery`
- `/crm/dm-queue`
- `/crm/email-queue`
- `/crm/insurance`
- `/crm/leads`
- `/crm/onboarding`
- `/crm`
- `/crm/replies`
- `/crm/reports`
- `/crm/suppressed`
- `/crm/unified-dashboard`
- `/insurance/activity`
- `/insurance/discover`
- `/insurance`
- `/insurance/pipeline`
- `/insurance/tasks`
- `/login`
- `/.`
- `/workspace`

## Existing API inventory (before HQ work)

- `/api/admin/all-leads`
- `/api/admin/automation-pipeline`
- `/api/admin/bulk-import-leads`
- `/api/admin/bulk-research`
- `/api/admin/bulk-score-and-clean`
- `/api/admin/cleanup-orphaned-scores`
- `/api/admin/debug-leads`
- `/api/admin/discover-leads`
- `/api/admin/discovered-leads`
- `/api/admin/lead-status`
- `/api/admin/status`
- `/api/ai/classify-reply`
- `/api/ai/get-summary`
- `/api/ai/summarize`
- `/api/appointments`
- `/api/auth/login`
- `/api/auth/logout`
- `/api/crm/automation`
- `/api/crm/bookings`
- `/api/crm/call-queue`
- `/api/crm/dm-queue`
- `/api/crm/export-leads`
- `/api/crm/insurance/action`
- `/api/crm/insurance/draft`
- `/api/crm/insurance/prospects`
- `/api/crm/insurance/recruiting-queue`
- `/api/crm/insurance/search`
- `/api/crm/insurance/workspace`
- `/api/crm/log-call`
- `/api/crm/log-status`
- `/api/crm/mark-dm-sent`
- `/api/crm/onboarding-completed`
- `/api/crm/onboarding-queue`
- `/api/crm/onboarding-sent`
- `/api/crm/replies`
- `/api/crm/reports`
- `/api/crm/research-center`
- `/api/crm/stats`
- `/api/crm/suppressed/action`
- `/api/crm/suppressed`
- `/api/crm/update-booking`
- `/api/crm/workspace`
- `/api/cron/automation`
- `/api/cron/daily-digest`
- `/api/cron/discover-leads`
- `/api/cron/enrich-leads`
- `/api/cron/insurance-pipeline`
- `/api/cron/poll-replies`
- `/api/cron/process-discovered-leads`
- `/api/cron/process-followups`
- `/api/cron/research-leads`
- `/api/cron/send-daily-emails`
- `/api/email/bulk-ready`
- `/api/email/debug`
- `/api/email/queue`
- `/api/email/queue-action`
- `/api/email/send-batch`
- `/api/email/send-daily`
- `/api/email/tracking`
- `/api/email/unsubscribe`
- `/api/scrape-phone`
- `/api/webhooks/resend`
- `/api/workspace/select`
