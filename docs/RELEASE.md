# CRM release ownership

Canonical repository: PeterdQuinn/fullstack-crm. Vercel project: fullstack-crm, production branch main. Production alias: https://fullstack-crm-nine.vercel.app.

Website/client portal is the separate PeterdQuinn/fullstackservicesllc repository. Coordinated release reports live under docs/legion/releases in that repository. Do not create another CRM repository or duplicate the existing business scheduler.

Use a reviewed release branch from origin/main, run the offline suites and production build, verify a protected preview with the website gateway, then merge and verify both deployment SHAs. Never publish environment files or local source-recovery archives.

The authenticated website proxy marks embedded requests with x-legion-embedded. CRM layouts select the shared owner shell for those requests and preserve standalone navigation otherwise. The static asset prefix /_legion/crm works on both hosts through an internal rewrite. This request marker changes presentation only; existing authentication remains mandatory.

Cloud provider configuration and fallback order remain owned by each task's configured provider chain. Existing cron schedules, sending controls and paused insurance settings are not activated or duplicated by releases. Data migrations are separate, catalog/history-verified operations.

Rollback: retain the previous Vercel production deployment ID before promotion. Restore production traffic to that deployment if a verified release failure occurs; restore only release-added environment changes from the private pre-release metadata when needed. Never rerun pipeline jobs as a rollback test.
