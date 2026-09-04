# Desktop MVP runbook

This is the lean operating path for the desktop MVP. There is no permanent staging environment yet.
A zero-traffic Cloud Run candidate provides the pre-production gate inside the isolated production
project.

## Environment boundaries

| Lane | Identity | Billing | Configuration source | Purpose |
| --- | --- | --- | --- | --- |
| Local | Clerk development | RevenueCat sandbox | Ignored root `.env`, synchronized from pinned development Secret Manager versions | Daily coding and local acceptance |
| Pull request | Test fixtures only | Test fixtures only | Committed examples and CI configuration | Review, tests, and contract validation |
| Production candidate | Clerk production | Explicit sandbox or production mode | Pinned production Secret Manager versions through WIF | Zero-traffic API and draft desktop acceptance |
| Production | Clerk production | RevenueCat production | The same reviewed production versions | Live API and published desktop updates |

Never put production credentials in the local `.env`, and never put long-lived credentials in
GitHub. Expo `EXPO_PUBLIC_*` values are embedded client configuration, even when their pinned source
is Secret Manager.

## First local setup

Run from the Git root containing `package.json`:

```bash
npm ci
npm run setup:backend
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

```bash
git switch -c feat/<small-change>
npm run env:check
npm run dev:desktop
```

Before opening a pull request:

```bash
npm run verify:full-stack
git push -u origin feat/<small-change>
```

Open a pull request into `main`. CI repeats the deterministic checks. Keep changes on a feature
branch; `main` is the reviewed source of truth.

## Production API release

Merging to `main` does not automatically deploy production. Start the **Deploy production API**
GitHub Action with the exact reviewed 40-character `main` commit. It:

1. verifies and builds an immutable container digest;
2. deploys a zero-traffic candidate;
3. checks liveness, readiness, authentication rejection, and unchanged billing mode;
4. pauses for approval on the protected `production` environment;
5. promotes the exact candidate and rolls back if canonical smoke tests fail.

A separate permanent staging project is intentionally deferred. Add one only when simultaneous
release testing, team access, or production-like data workflows make the zero-traffic gate
insufficient.

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

Do not publish the draft until installed-app credential authentication, onboarding, sandbox or live
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
- Sandbox desktop builds remain internal draft prereleases.
- The website download stays disabled until a signed production-mode draft passes clean-Mac acceptance.
