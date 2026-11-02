# Vercel deployment source inventory

Status: blocked on authenticated Vercel access. No project-to-repository mapping
has been verified from Vercel metadata. Project names are not repository names.

| Vercel project | Connected Git provider | Exact repository owner/name | Production branch | Production URL | Latest production commit SHA |
| --- | --- | --- | --- | --- | --- |
| [fullstack-crm](https://vercel.com/peterdquinns-projects/fullstack-crm) | Unverified | Unverified | Unverified | Unverified in Vercel | Unverified |
| [peter-insurance](https://vercel.com/peterdquinns-projects/peter-insurance) | Unverified | Unverified | Unverified | Unverified | Unverified |
| [hvac-2026](https://vercel.com/peterdquinns-projects/hvac-2026) | Unverified | Unverified | Unverified | Unverified | Unverified |

## Access attempts

- Opened each exact supplied dashboard URL with the web reader; none returned
  project settings or deployment metadata.
- Vercel plugin discovery found the Vercel integration, but it is not connected.
- Opened Settings / Git and Production deployments for each exact project
  through TinyFish. All six URLs returned `login_required`; the overview pages
  exposed only a loading shell, with no Git or deployment source metadata.
- Vercel CLI is installed. `vercel project inspect <exact-project> --scope
  peterdquinns-projects` failed loading the user with `fetch failed` for all
  three projects.
- Available browser profiles contain no recorded Vercel sign-in. Authenticated
  navigation requires connecting Vercel or setting up a signed-in browser.

## Verification procedure once access is restored

For each exact project, inspect Settings / Git for the connected provider,
repository and production branch. Inspect the current Production deployment
for its source repository, full commit SHA and assigned production domain(s).
Record both the latest deployment and current production deployment if they
differ; a preview or failed latest deployment must not be reported as live.
Record whether deployment source is Git, CLI or another mechanism. A project
without a Git connection must be recorded as such, not assigned a repository.
Only then audit the repositories Vercel identifies.

## Preserved work

Repair commit `e172d7bf12a49cc56342d1a25846e7aeca2abdf0` remains on `main` and
`preservation/insurance-schema-repair`. HQ drafts are uncommitted on
`feat/full-stack-hq`; they do not alter the repair commit. Local workspace-shell work is separately authorized. Source-dependent external
integrations remain paused until project mappings are established.
