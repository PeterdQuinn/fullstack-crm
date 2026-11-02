# Full Stack HQ workspace refactor

This supersedes the initial top-level HVAC navigation proposal. The existing
application becomes HQ; no additional app, repository or database is created.
Repair commit e172d7bf12a49cc56342d1a25846e7aeca2abdf0 stays unchanged.

## Feature mapping before implementation

| Existing source | Workspace | Business unit | Reuse decision |
| --- | --- | --- | --- |
| /crm/unified-dashboard, /crm/leads, CRM workspace API | Full Stack Services | full_stack_core (existing records) | Preserve routes and components |
| /crm/call-queue, /crm/dm-queue, /crm/discovery | Full Stack Services | full_stack_core | Preserve outreach/research/discovery |
| /crm/email-queue, /crm/replies, /api/email | Full Stack Services | full_stack_core | Preserve send/suppression/idempotency |
| /crm/bookings, /crm/onboarding, /crm/reports | Full Stack Services | full_stack_core | Preserve booking/onboarding/reports |
| /crm/automation, /api/cron, automation_runs | Full Stack / Admin | full_stack_core; insurance runs retain stage | Keep cron auth and audit trail |
| /insurance/*, /crm/insurance, /api/crm/insurance | Peter Quinn / Insurance | insurance | Reuse existing board, tasks, activity, settings, discovery and outreach |
| Insurance Supabase prospects/activities/tasks/settings/outbox | Peter Quinn / Insurance | insurance | Keep separate database; additive context migration only |
| HVAC public demo | Full Stack Services | hvac | Nested module; demo figures never live HQ revenue; no database import |
| /workspace, /login, session middleware | Shared identity | both | Existing operator login; HQ business switcher; retain legacy tokens |
| New documents, projects, proposals, contracts, RFPs, contacts, campaigns, cases | Owning workspace | validated business unit | Central contextual records, not duplicate legacy lead/outbox tables |
| Unified search/inbox/calendar/tasks/documents | Shared | permission-checked aggregation | Read original legacy records plus HQ-native records |
| /api/admin, systems registry | Admin | platform | Owner only; no new role self-assignment |

All existing leads stay Full Stack/core. HVAC classification requires an
explicit record context; a lead's niche alone does not reclassify it. Historical
insurance records stay in insurance. The signed workspace cookie controls
navigation context, not authorization or a database credential.

## Data and migration boundaries

Apply 030 and 031 to the FSS/HQ database. Apply the separate
supabase/insurance-migrations/001_hq_context.sql only to the insurance database,
after its schema is provisioned. Nothing applies migrations automatically.
Additive defaults preserve old writers. No production tables are dropped.

HQ workspaces are full_stack and peter_quinn; valid unit pairs are
(full_stack, full_stack_core), (full_stack, hvac), (peter_quinn, insurance).
Central hq_records indexes records with a type, owner, contact/company/project
references, due date and explicit context. Documents use a private storage
bucket and authenticated signed downloads. Email records carry direction,
sender, recipient and associations; existing outreach stays in its own outbox.
No email is sent by the generic records API.

Legacy associations are opaque source-prefixed identifiers (e.g.
crm:lead:<uuid> or insurance:prospect:<uuid>), because cross-database foreign
keys are not available. Search returns source/context and original module links.
No automatic copying, scraping, embedding or AI processing of private files.
Existing company proposals/files/email archives have not been bulk imported.

## Auth and later SSO

Today: one configured operator uses Basic auth or signed HttpOnly session
cookies. That verified operator is owner. Existing cookie names, signatures,
workspace values fss/producerforge, cron secrets and webhook signatures stay.
Role vocabulary: owner, admin, sales, developer, insurance, operations, client.
New multi-user access is not enabled: existing service-role CRM endpoints must
first receive tenant/workspace permissions and adversarial isolation tests.

External HVAC shows public demo access and an owner-protected staff-account
surface; source enforcement is unverified. The insurance public domain exposes
marketing/assessment/booking; private operations and its identity provider are
unverified. Full Stack's /portal requires login; provider unverified. Exact
Vercel-to-repository mappings remain blocked on authenticated Vercel access.

SSO target: one OIDC identity provider, authorization-code flow with PKCE,
server-side token validation and per-app host-only sessions. Do not share
passwords/signing secrets or set a cross-app vercel.app cookie. Map immutable
identity subjects to workspace memberships; separate role and unit grants,
least-privilege adapters, logout/revocation, MFA and audit logs. Cut over one
verified app at a time with the operator path retained during transition.

## Shared services and AI

Future target only:
fullstack-platform/apps/{hq,insurance,hvac,client-portal}
fullstack-platform/packages/{ui,auth,database,ai,email,analytics,config}
Extract stable contracts after auditing the actual source repositories; keep
business models, database credentials and public funnels separate for now.

HQ's read-tool catalog includes leads, deals, insurance pipeline, HVAC activity,
tasks, projects, health, recent activity and revenue opportunities. It does not
expose generic mutation tools to a model. Manual record creation/upload is
explicit operator action. Any future action tool requires permissions, preview,
approval, idempotency and an audit record. Daily briefing remains labelled as
planned; deterministic priorities do not invent dollar values.
