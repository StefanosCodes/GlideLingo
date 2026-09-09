# Desktop-first development runway

This is the current operator entry point for building and shipping GlideLingo. Desktop is the first
controlled product target, but it continues to use the shared Expo routes, features, authentication,
API boundary, and design system that iOS and Android will use later.

## 1. Start from a clean focused branch

Run commands from the repository root containing `package.json` and `AGENTS.md`.

```bash
npm ci
npm run setup:backend
npm run setup:tutor
npm run env:sync:development
npm run env:check
npm run dev:desktop
```

Before the first environment sync, authenticate `gcloud` and select the exact
`glidelingo-development` project. The sync reads pinned development Secret Manager versions into
the ignored root `.env` without printing their values. On normal days, run only `env:check` and
`dev:desktop`; resync when the check reports an intentional secret-version change.

`npm run dev:desktop` starts local PostgreSQL, FastAPI, Expo web, and the source Electron window.
Use `npm run diagnose` only when startup fails. Do not clear caches or reset data as routine setup.

## 2. Register and sign in locally

Local Electron uses the Clerk development instance configured by the ignored root `.env`. A clean
account journey is:

```text
Create account
→ enter email and password
→ enter the email verification code
→ provide first name
→ reach the signed-in app
→ sign out
→ sign in again
→ quit and relaunch with the same profile
```

Clerk owns the account and session. The app keeps learning state on the device today; FastAPI
verifies the Clerk bearer session for authenticated API operations. Resetting local PostgreSQL does
not delete the Clerk identity or Electron-local state.

Use `npm run e2e:local:prepare -- --confirm glidelingo-local` only when an explicitly clean local
journey is required. It deletes the reviewed local application rows while preserving the Docker
volume, schema, and migration ledger. A genuinely new-account test still requires a never-used email
and the verification code delivered to that address.

## 3. Verify and open the PR

The normal loop is intentionally short:

```text
focused branch
→ npm run verify
→ pull request
→ required Verify check
→ merge
```

When course JSON or schemas change, run `npm run course:validate` before `npm run verify`. The
validator is local and deterministic; it does not need an AI, audio, or network credential.

Use `npm run verify:full` when Expo dependencies/configuration, Electron packaging, FastAPI, the
private tutor service, or database wiring changed. User-facing desktop behavior also needs a visible
Electron run; compilation alone is not acceptance.

Keep feature PRs focused. Do not mix a course, onboarding, voice, marketplace, or analytics feature
with CI/release cleanup. Large preserved branches should be reviewed as vertical slices before any
part is merged.

## 4. What deploys after merge

Every push to `main` runs the same `Verify` job. After it succeeds, GitHub Actions builds the FastAPI
container, pushes the commit-addressed image, deploys it to production Cloud Run, and smoke-tests
`/health/live` and `/health/ready`.

That automatic lane updates the server only. It does not publish a new desktop binary.

## 5. How installed desktop users receive app changes

Changes under `src/`, `desktop/`, or packaged assets reach installed users only through a new desktop
version:

```text
bump desktop/package.json
→ npm run desktop:release:preflight
→ merge version PR to main
→ create protected desktop-v<version> tag
→ signed/notarized GitHub workflow creates draft
→ accept exact draft artifacts
→ complete clean-install and forward-update checks
→ publish that release as Latest
```

The packaged macOS app checks once on launch. Draft releases are invisible. When a newer published
release exists, the app downloads it and offers **Restart and update**; choosing **Later** leaves a
restart action for that launch. It does not install silently on quit. A valid API minimum-version
policy can require an update, but the current default minimum is `0.0.0`.

The currently published channel is `desktop-v1.0.8`. It proves signed direct distribution and the
GitHub updater channel. Billing is still configured as sandbox for prelaunch testing, so this is not
evidence that live commerce is ready.

Website-only changes deploy separately and do not require a desktop version bump. API-only changes
normally use the automatic server lane as long as they remain compatible with installed clients.

## 6. Mobile readiness without desktop duplication

Keep product behavior in shared routes and feature modules. Electron resolves the web platform
implementation; iOS and Android resolve native implementations only where the capability genuinely
differs. Keep authentication, API contracts, authorization, and durable data ownership compatible
with clients that may remain installed across multiple server releases.

Detailed references:

- [Local development and operations](./LOCAL-DEVELOPMENT.md)
- [Deployment architecture](./DEPLOYMENT.md)
- [Desktop release operations](./DESKTOP-RELEASE.md)
- [Desktop authentication acceptance](./DESKTOP-AUTH-ACCEPTANCE.md)
- [Feature development](./FEATURE-DEVELOPMENT.md)
