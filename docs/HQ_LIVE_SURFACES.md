# Verified live surfaces

These URLs were supplied by Peter and inspected read-only. They establish
visible application roles, not Vercel-to-Git repository mappings. The exact
connected provider, repository, branch and deployed SHA still require the
authenticated Vercel project settings described in VERCEL_PROJECT_MAPPING.md.

## HVAC

URL: https://hvac-2026.vercel.app/dashboard

Observed page title: Full Stack Services LLC — HVAC Dashboard.
Public navigation exposes dashboard, dispatch, jobs, customers, technicians,
invoices, pricebook, reports, automations, activity, settings and a `/field`
surface. This confirms visible feature surfaces, not their database models,
API contracts, write behavior or authentication configuration.

The dashboard explicitly labels its operating date as the latest scheduled
demo day (2026-07-25 during inspection). The missed-call walkthrough says
"Demo action only" and that no Twilio account or SMS is involved.
The Full Stack Services marketing site also links this URL as a demo and
states that demo data is shown.

The inspected `/dashboard/settings` page explicitly reports public demo mode,
owner-protected staff account management, and owner/dispatcher/technician
access concepts. It says live technician access uses `/login`, QuickBooks is
simulated (no live OAuth/sync), online charging is disconnected, and SMS needs
provider configuration. These are UI statements; the underlying enforcement
and database provider remain unverified without source access.
`/dashboard/automations` reports manual checks with scheduler setup pending,
and lists assignment, invoice and quote reminders. `/field` identifies itself
as a technician preview using demo data. No actions or writes were triggered.

HQ decision: link the existing HVAC application as a demo until production
data and authentication are verified. Do not import its invoices, job totals
or revenue figures into Peter's live operating priorities. Keep scheduling,
dispatch, job and billing implementations in this app while the source audit
is pending. Do not build duplicate HVAC CRUD screens in HQ.

## Insurance public property

URL: https://www.peterdquinn.com/

Observed brand: Quinn Consulting / Peter Quinn. Public insurance education,
coverage explanations, high-income strategy assessment, IUL guides and
Calendly consultation booking are visible. Public links include
`/high-income-strategy`, `/iul`, IUL comparison/loan guides and legal pages.

Classification A: confirmed public marketing and funnel surfaces.
Classifications B (authenticated operations), C (duplicate CRM) and D (shared
services) remain unverified without source and authenticated access.
The `/high-income-strategy` page was also inspected: it exposes an assessment
surface, worksheet download and strategy-session booking. No assessment was
submitted and its submission API/data destination remains unverified.
No evidence from the homepage establishes the `peter-insurance` Vercel project
or any repository connection; the domain-to-project mapping is pending.

HQ decision: retain the public website as an acquisition property. HQ's
existing insurance prospects/tasks/settings/outreach remain the operating
pipeline. Integrate consented assessment/booking events only after inspecting
the source contracts, authentication, data ownership and deduplication rules.

## Full Stack Services public property

URL: https://www.fullstackservicesllc.net/

Observed role: public custom software and managed services marketing, service
and industry pages, project examples, consultation funnel, and a `/portal`
entry. It links the supplied HVAC dashboard as an operations platform demo.
The existence of a portal link does not establish its auth provider or a
working authenticated client application. No repository or Vercel project
mapping is inferred from this domain.
The public `/portal` URL returned `login_required` during inspection; its
authenticated routes, provider and session handling remain unverified.

HQ decision: keep public marketing separate from the internal HQ interface.
Preserve any existing client portal; audit its identity and project/task
contracts before planning shared SSO or a future client-portal package.
No new fourth application is required for any of these decisions.
