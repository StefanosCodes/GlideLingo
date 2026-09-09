# Desktop MVP runbook

This is the lean operating path for the desktop MVP. There is no permanent staging environment yet:
the pull-request `Verify` job is the pre-merge gate for server changes, while exact signed desktop
drafts provide the pre-publication client gate.

## Environment boundaries

| Lane | Identity | Billing | Configuration source | Purpose |
| --- | --- | --- | --- | --- |
| Local | Clerk development | RevenueCat sandbox | Ignored root `.env`, synchronized from pinned development Secret Manager versions | Daily coding and local acceptance |
| Pull request | Test fixtures only | Test fixtures only | Committed examples and CI configuration | Review, tests, and contract validation |
| Signed desktop candidate | Clerk production | Explicit sandbox or production mode | Pinned production Secret Manager versions through WIF | Draft artifact acceptance before publication |
| Production | Clerk production | RevenueCat production | The same reviewed production versions | Live API and published desktop updates |

Never put production credentials in the local `.env`, and never put long-lived credentials in
GitHub. Expo `EXPO_PUBLIC_*` values are embedded client configuration, even when their pinned source
is Secret Manager.

## First local setup

Run from the Git root containing `package.json`:

```bash
npm ci
npm run setup:backend
npm run setup:tutor
gcloud config set project glidelingo-development
npm run env:sync:development
npm run env:check
npm run dev:desktop
```

`env:sync:development` updates only the managed development block in the ignored root `.env`, writes
it with mode `0600`, and never prints secret values. `env:check` proves that every managed value still
matches its pinned development Secret Manager version.

For a RevenueCat webhook test, keep FastAPI on port `8123` and run:

```bash
ngrok http 8123 \
  --url https://tinker-devoutly-fondue.ngrok-free.dev \
  --traffic-policy-file "$HOME/Library/Application Support/ngrok/glidelingo-revenuecat-policy.yml"
```

The local traffic policy admits only `POST /v1/billing/revenuecat/webhook`; FastAPI then verifies the
configured Authorization value and HMAC signature. Google and Apple sign-in do not use ngrok.

## Daily development loop

GitHub exposes two operator-facing workflows. **CI/CD** runs the same single `Verify` job for pull
requests and `main`; only the pull-request result is the required merge gate. After verified `main`
changes, that workflow automatically builds and deploys the production FastAPI service and checks
liveness/readiness. **Desktop Release** remains the separate signed/notarized client release path.

```bash
git switch -c feat/<small-change>
npm run env:check
npm run dev:desktop
```

Before opening a normal pull request:

```bash
npm run verify
git push -u origin feat/<small-change>
```

Use `npm run verify:full` when Expo configuration/dependencies, desktop packaging, API, tutor, or
database wiring changed, and `npm run verify:full-stack` when the real local PostgreSQL integration
is affected. Open a pull request into `main`, wait for the required `Verify` check, and merge only
the focused change. Keep `main` as the reviewed source of truth.

## Production API release

Merging to `main` automatically starts the production API lane after verification. It:

1. reruns the repository `Verify` job;
2. authenticates to Google Cloud through short-lived Workload Identity Federation;
3. builds and pushes a commit-addressed API image;
4. deploys that image to production Cloud Run;
5. checks `/health/live` and `/health/ready`.

Database migrations are not coupled to ordinary app startup or this automatic deploy. Apply a
reviewed migration separately through the guarded operator procedure before or after the compatible
API version as that migration's expand-and-contract plan requires.

A separate permanent staging project is intentionally deferred. Add one only when simultaneous
release testing, team access, or production-like data workflows justify its operating cost.

## Desktop release and updates

Marketing-site files under `website/` are not part of the Electron package. Update the desktop
version only when changes to the Expo application, Electron shell, or packaged assets should reach
installed users.

For a desktop release:

1. Create a small version-bump branch from fresh `origin/main`. Update `desktop/package.json` and
   both version fields in `desktop/package-lock.json` to one unused patch version.
2. Run `npm run desktop:release:preflight`. Fix every failure before opening the pull request.
3. Merge the reviewed version PR, record its exact 40-character commit, and create the protected
   matching tag `desktop-v<version>` on that commit.
4. Run the **Desktop Release** workflow. It uses WIF and pinned GCP Secret Manager versions to build,
   sign, notarize, and stage a private universal macOS draft.
5. From the exact tagged checkout, run
   `npm run desktop:release:accept-draft -- desktop-v<version>`.
6. Install the retained DMG normally and complete the signed-app checklist before separately
   approving publication or website activation.

The preflight produces unsigned local DMG/ZIP/update metadata and proves the package shape. Draft
acceptance downloads and verifies the exact signed artifacts. Neither replaces the first real
published `N → N+1` updater acceptance test. Drafts are invisible to installed apps; the release
pipeline remains responsible for signing and validating every distributed application and updater payload.

Do not publish a customer release until installed-app credential authentication, onboarding, live
checkout, entitlement reconciliation, launch, and applicable update acceptance have passed. Publishing
the approved GitHub release makes it visible to already-installed apps and the website's fallback
GitHub Releases page. Activating the website's direct DMG link is a separate approved deployment.
Packaged macOS apps check once per launch and download a newer published release automatically. When
the update is ready, the learner can restart immediately or choose Later; the restart action remains
available in the sidebar. The public API can mark versions below its reviewed numeric-SemVer minimum
as required, which removes Later while preserving retry, official-download, and quit recovery paths.

## Current fail-closed gates

- Production Terraform cannot activate billing without a complete, environment-matched set of pinned
  RevenueCat versions.
- Desktop signing cannot start until the committed production identity manifest contains the reviewed
  numeric GCP project number.
- The current published `desktop-v1.0.8` channel uses sandbox billing and is prelaunch distribution,
  not proof of live-commerce readiness.
- Customer activation requires a signed production-billing forward release that passes clean-Mac
  installation, auth, billing, and updater acceptance.
