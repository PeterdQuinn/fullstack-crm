# November 22, 2026 — CRM duplicate-mailbox alert repair checkpoint

## Verified production state

- Canonical checkout: `~/Desktop/crm/fullstack-crm`, remote `PeterdQuinn/fullstack-crm`.
- Fix branch `fix/duplicate-mailbox-send-deferrals` is based on fetched `main` commit `d2487007a86a695a9f9323f3aa3e14b37f08fc36`. An older separate clone at `~/Desktop/Full Stack Finished Clients /fullstack-crm` is behind and was not used.
- Production is Vercel deployment `dpl_8c4VvZwh79Pyun3c7QbSiL2WnSqU`, Ready, alias `https://fullstack-crm-nine.vercel.app`. The fix is local and is not in that deployment.
- Read-only authenticated smoke: anonymous `GET /api/crm/automation` returned 401; authenticated `GET /crm/automation` and `GET /api/crm/automation` returned 200. Automation is enabled. Production still reports the latest send and process-discovered-leads runs as failed; this checkpoint did not run a live cron or send email.
- Read-only Supabase verification passed all 17 required schema columns and pipeline invariants: 4,263 total leads, 46 archived, 4,217 active/unarchived, 827 scored, 775 above the send threshold and 420 in sendable statuses. Cron route execution was skipped because that verifier would run live workflows and the digest sends email.
- Read-only outbox review found exactly two duplicate-mailbox hold rows, both `needs_review`, for the same mailbox shared by **Los Angeles Roofing & Commercial Roof Repair** (lead `e3a4171e-9209-4132-8845-9794555f3a2d`) and **Eagle Roofing Repair Los Angeles** (lead `71252ff3-1ac9-4156-907a-e6d5bca5da46`). Both show `Ready for Outreach` and neither is marked opted out, bounced or complained. The mailbox is redacted in logs. These are separate business records; no identity was inferred, no records were merged, and neither held message was released.

## Source change and safeguards

- Only a duplicate hold written successfully to `email_outbox` with the exact review reason is surfaced as `PersistedEmailReviewHoldError`. Re-reading the same idempotency key in `needs_review` returns that hold without repeating mailbox checks or attempting provider delivery.
- A persisted `cancelled` row with the exact ineligible-recipient reason is a skip. Unknown `needs_review`/`cancelled` reasons, database reads/writes, provider failures, unrecognized deferrals and outbox persistence failures remain errors.
- The automation send loop counts recognized holds/cancellations as skipped and continues to the next eligible lead. Recovery already excludes `needs_review`; its error classifier now recognizes only the typed persisted states. Existing mailbox, tenant, suppression, reply, idempotency and cap checks remain enabled.
- No code path automatically changes a hold back to pending. A hold remains blocked until an owner documents a resolution and explicitly changes its state; there is no owner release control in the current UI.
- No outbox row or lead record was changed during this investigation. Actual outbound message count for this work: zero.

## Verification

- Focused synthetic outbox regression: passed, including a held recipient followed by an eligible send, persisted duplicate hold, repeated same-key hold, cancellation, unknown hold failure, provider idempotency, same-tenant peer filtering, suppression/reply safeguards, outbox-write failure and genuine failure alert path. All Supabase and Resend behavior in the test is mocked.
- CRM `npm test`: passed all included suites: automation contract 208, AI normalization 23, cron workflow 9, backend-auth 12, plus reply policy, outbox hold, automation retry, insurance, email extraction/languages and HQ tests.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run build`: passed (Next.js 14.2.35 compile, lint/type validation, 58 static pages).
- `npm run verify`: passed 17/17 schema checks and production pipeline checks (0 failures, 0 warnings) after fixing quoted-value parsing in the read-only verification script.
- This repository has no separate configured lint or browser/E2E npm script. Authenticated production HTTP checks were run; no live cron route was invoked.

## Release position

The fix is committed as `f6e44f4` and pushed to `origin/fix/duplicate-mailbox-send-deferrals`; its base is `d2487007a86a695a9f9323f3aa3e14b37f08fc36`. Production remains on `d2487007`. PR creation was attempted through the connected GitHub integration and returned HTTP 403 (`Resource not accessible by integration`); GitHub CLI authentication is also invalid. An existing open PR #4 (`fix/legion-duplicate-batch`) contains a narrower related hold handler, but does not include this change’s held-idempotency and strict persistence/error classification. Keep the new fix isolated for independent review. Create its PR at https://github.com/PeterdQuinn/fullstack-crm/pull/new/fix/duplicate-mailbox-send-deferrals, target `main`, then require independent review and the normal release process. Do not run live automation until the reviewed fix is deployed, because it may send to real prospects.

---

# CRM project status and handoff

Updated November 15, 2026 (America/Phoenix). This is the CRM handoff summary. The website repository's `STATUS_REPORT.md` is the master work log; `docs/legion/GOLD-CHECKLIST.md` owns the four phases. Do not create a second roadmap here.

Canonical repositories: `PeterdQuinn/fullstackservicesllc` (website/portal/owner entry) and `PeterdQuinn/fullstack-crm` (this CRM/HQ). Each has its own Vercel deployment from `main`. The old `fullstack-crm-hq` remote is retired.

## Working and previously verified

- November 15 production CRM release: `d2487007`, deployment `dpl_8c4VvZwh79Pyun3c7QbSiL2WnSqU`. The website release reports record coordinated owner desktop/mobile checks and standalone CRM login/assets/logout.
- Owner website login opens same-origin CRM/HQ with shared navigation. Direct CRM login remains available. Website and direct CRM sessions are separate boundaries.
- Existing primary CRM automation remains enabled with its existing scheduler and safeguards. This is not evidence that every stage completed a fresh live run during cleanup.
- Existing cloud AI providers and fallback order remain supported. Self-hosted worker/model services do not impose local-only application routing.
- LangGraph/Activepieces runtime commissioning, recovery and persistence were verified on the Mac. It requires the Mac powered and logged in; backups remain on the same disk. This notes update did not rerun live health checks.

## Latest work: local, not released

| Files | Change |
| --- | --- |
| `lib/operator-auth.ts`, middleware, `lib/hq/auth.ts`, login route | Shared configured-operator credential/session verification |
| `lib/auth-credentials.ts` | Runtime-neutral credential comparison and scheduler bearer verification |
| `lib/cron-auth.ts`, all ten cron route files, `lib/automation-runs.ts` | Shared rejection policy preserving response compatibility and run/pause behavior |
| Scraper route | Reuses scheduler bearer verification; existing signed-session path retained |
| `scripts/backend-auth-test.cjs`, package scripts and existing test loaders | Offline authentication rejection coverage integrated into the normal suite |
| Architecture notes and website master/phase documents | Correct repository/rendering/cloud facts, system ownership and next-work order |

Verification from this work batch: 113 website tests; all nine preexisting CRM suites; 12 new authentication tests; CRM TypeScript and production build passed. New tests invoke each exported cron HTTP handler with unauthorized credentials and assert no database/business execution. No live cron jobs, campaigns or model configuration changes were performed.

These follow-up changes are local working-tree files: no commit, push or deployment has occurred for them. Previously released production behavior remains the baseline above.

## Phase position and direction

1. **Phase 1: primary CRM audit/security complete within recorded scope.** Preserve migration history, tenant boundaries, duplicate/suppression checks and outreach guards. Separate insurance database work remains deferred.
2. **Phase 2: operational acceptance open.** Installed runtime, persistence and controlled recovery are verified. The November 15 completion review requires unattended startup/cold-boot verification, off-device backup/restore and endurance evidence before full completion. Fresh 5:42 PM Arizona check found all six services healthy; that does not close those requirements.
3. **Phase 3: Qwen3 evaluation in progress.** Consultant grounding remains held. Next evaluate actual consumer contracts, representative contexts, deadlines/cancellation/load, latency and cost while retaining cloud fallback behavior.
4. **Phase 4: deferred.** Do not infer its scope or start it automatically.

Next release step: review local source, verify protected-preview owner and standalone CRM access, and obtain the required approval before production rollout. Record actual commit/push/deployment evidence afterward. Resolve Phase 2 operational acceptance before advancing phases. Earlier Phase 3 evaluations remain evidence; cleanup does not constitute model approval.

## Remaining gaps

- Production review-queue connectivity to the Mac is not configured; new lead intake remains disabled.
- Generic LangGraph tasks are approval-required and take no external action; a completed business-agent team is not implied.
- CRM identity remains single-operator. Full multiuser SSO/RBAC is not implemented.
- Legacy APIs remain compatible pending caller inventory/migration. Manual research POST retains its existing authenticated pause bypass. Disabled daily-send compatibility route still returns 410 after authentication.
- Insurance business work is deferred; no fresh production pause-switch probe is claimed here.

## Keep notes current

After each batch record date, changed files/behavior, actual checks/results, deployment state, blockers and next step in the master log and update this summary when CRM status changes. Never equate a successful local build with a deployed release. Historical reports remain evidence, not current live health claims.
