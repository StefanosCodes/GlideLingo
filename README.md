# GlideLingo

GlideLingo is an Expo SDK 57 app using TypeScript and Expo Router. The same source project targets Android, iOS, web, and an Electron desktop shell.

## Development cycle

Install the locked environments once per checkout:

```bash
npm ci
npm run setup:backend
npm run setup:tutor
```

The normal product loop is intentionally short:

1. Create one focused branch from current `main`.
2. Run `npm run dev` for Expo/mobile/web, or `npm run dev:desktop` for Electron.
3. Before pushing, run `npm run verify`. Use `npm run verify:full` when Expo configuration, dependencies, desktop packaging, backend, tutor, or database wiring changed.
4. Open a PR. The single required `Verify` check covers the app, desktop export, API, tutor service, and website.
5. Merge when `Verify` is green. `main` is verified again and the API deploys automatically; desktop distribution remains a separate intentional release.

Use `npm run diagnose` only when the local stack does not start cleanly. Cache-clearing commands are recovery tools, not routine setup.

For the complete register/sign-in, testing, API-deploy, desktop-release, and installed-user update
path, use the [desktop-first development runway](docs/infra/DEVELOPMENT-RUNWAY.md).

## Full-stack foundation

The repository now contains the desktop-first full-stack foundation:

- Expo SDK 57 serves Android, iOS, and web from one TypeScript application.
- Electron packages the Expo web target as the macOS desktop application.
- FastAPI exposes health, verified Clerk session, desktop update-policy, RevenueCat entitlement, and
  dormant lesson-tutor boundaries on port `8123`.
- Docker Compose runs a project-owned PostgreSQL instance on `55433`.
- The internal `/diagnostics` route proves the client-to-database wiring.

The long-term direction, folder ownership, feature-development pattern, local operations, deployment
lanes, and implementation roadmap live in [`docs/infra/README.md`](docs/infra/README.md). Production
Cloud Run and Cloud SQL, Clerk authentication, server-owned entitlement authorization, database
migrations, and the signed desktop release/update channel now exist. General server-side learner
progress, background workers, and tutor activation remain intentionally deferred.

## Learning system reference

The language-independent course standard, versioned content contract, reusable course outline,
progress rules, and learning-system execution plan live in
[`docs/learning/README.md`](docs/learning/README.md).

Course schemas, deterministic validation, the static runtime loader, and one draft migrated Greek
lesson exist today. Greek remains the first implementation case rather than a universal template;
the full mastery, publication, server-persistence, and authoring systems remain future work.

## Command center

Run commands from this directory—the one containing `package.json`:

| Goal | Command |
| --- | --- |
| Install the locked dependencies | `npm ci` |
| Install the locked backend environment | `npm run setup:backend` |
| Install the locked private tutor environment | `npm run setup:tutor` |
| Start PostgreSQL | `npm run db:up` |
| Reset local app tables, preserving schema/volume | `npm run db:reset:local -- --confirm glidelingo-local` |
| Start FastAPI | `npm run api` |
| Start database, API, and interactive Expo | `npm run dev` |
| Start database, API, and Electron | `npm run dev:desktop` |
| Start Expo for mobile | `npm start` |
| Open Android directly | `npm run android` |
| Open iOS directly | `npm run ios` |
| Open the Electron desktop app | `npm run desktop` |
| Bootstrap local development configuration once | `npm run env:sync:development` |
| Validate local development configuration offline | `npm run env:check` |
| Compare local configuration with pinned GCP versions | `npm run env:check:provenance` |
| Check the local environment | `npm run diagnose` |
| Validate versioned course packages | `npm run course:validate` |
| Run lint, types, and tests | `npm run verify` |
| Run all Expo and desktop checks | `npm run verify:full` |
| Run the database integration gate | `npm run verify:full-stack` |
| Prepare a clean local desktop E2E | `npm run e2e:local:prepare -- --confirm glidelingo-local` |
| Run real Clerk auth E2E in web and Electron | `npm run test:e2e:auth` |
| Clear mobile Metro state | `npm run start:clear` |
| Clear desktop Metro state | `npm run desktop:clear` |
| Build a local macOS `.app` | `npm run desktop:package` |
| Verify unsigned universal macOS packaging | `npm run desktop:package:dry-run` |
| Build configured macOS distribution artifacts | `npm run desktop:dist` |
| Build a signed/notarized universal release | `npm run desktop:release` |

The npm scripts are the source of truth for developers, CI, and Codex. `AGENTS.md` tells Codex when to use them, while `.codex/environments/environment.toml` exposes the common ones as one-click action buttons in the Codex desktop app.

## How the targets fit together

Expo owns the shared application and its Android, iOS, and web builds. Electron packages that web build in a real macOS desktop application:

- `npm run android` runs the native Android experience.
- `npm run ios` runs the native iPhone/iPad experience.
- `npm run web` runs the browser experience.
- `npm run desktop` runs the same web UI inside a real Electron desktop window.

UI and business logic are shared by default. When a target genuinely needs different behavior, use React Native's `Platform` API or platform files such as `Feature.ios.tsx`, `Feature.android.tsx`, and `Feature.web.tsx`. Electron uses the web implementation; desktop-specific native capabilities should be exposed through a narrow, validated preload API rather than enabling Node.js in the UI.

## Prerequisites

- Node.js 22.13 or newer and npm
- [uv](https://docs.astral.sh/uv/) for the locked Python 3.13 backend environment
- Docker Desktop for local PostgreSQL
- For a physical Android or iPhone: install a compatible Expo Go app
- For an Android emulator or local Android build: Android Studio, Android SDK 36, and JDK 17
- For the iOS Simulator or local iOS build: Xcode and an installed Simulator runtime

You do not need a global Expo CLI. Use the project-local CLI through `npx expo ...` or the npm scripts below.

## Run the starter

```bash
npm ci
npm start
```

Once Metro starts:

- press `a` for an Android emulator
- press `i` for the iOS Simulator
- press `w` for the desktop web app
- or scan the QR code with Expo Go on a physical device

The equivalent direct commands are:

```bash
npm run android
npm run ios
npm run web
```

Routes are files under `src/app`, and `src/app/_layout.tsx` owns the root navigation layout. Product behavior should move into `src/features` as each working feature is introduced.

## Run the full stack

Install both locked environments once, then start the database, API, and the client target you want:

```bash
npm ci
npm run setup:backend
npm run dev
```

The database and unauthenticated API health checks can use committed local defaults. The complete
desktop auth/billing journey requires the ignored root `.env` synchronized from the pinned
`glidelingo-development` Secret Manager versions. Follow the
[desktop MVP runbook](docs/infra/DESKTOP-MVP-RUNBOOK.md); use `.env.example` only as the public name
and safe-default reference.

`npm run dev` starts PostgreSQL, FastAPI, and interactive Expo. Press `a` or `i` in Expo for a native client. For the macOS desktop window instead, run `npm run dev:desktop`.

Open `/diagnostics` from the internal Prompt Kit screen to see the exact API origin, target platform, API reachability, and PostgreSQL readiness. Android emulators default to `10.0.2.2:8123`; iOS Simulator, web, and Electron development default to `localhost:8123`. A physical phone must receive an explicit reachable value such as `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8123` before Metro starts.

### Page-aware lesson tutor

The tutor is split across two FastAPI processes. The public API verifies Clerk, derives a
tutor-scoped HMAC pseudonym, applies PostgreSQL-backed idempotency and turn limits, and calls the
private service with a Google-signed ID token. The IAM-private tutor resolves whitelisted authored
lesson context and is the only runtime that imports the OpenAI Agents SDK or receives the OpenAI
secret.

The private payload is allowlisted: pseudonymous actor reference, server-generated turn reference,
lesson and visible-step fields, selected choice, current message, and at most eight history messages.
It excludes the Clerk token and subject, email/profile data, RevenueCat data, entitlement state, and
the client conversation UUID. The OpenAI request uses the pseudonym only as `safety_identifier`,
sets `store=false`, disables sensitive trace/model/tool logging, performs one model turn, and has no
provider retries.

All three feature flags remain disabled by default:

- `EXPO_PUBLIC_LESSON_TUTOR_ENABLED` controls client visibility.
- `GLIDELINGO_LESSON_TUTOR_ENABLED` controls the public gateway.
- `GLIDELINGO_TUTOR_ENABLED` controls the private OpenAI runtime.

Normal verification uses fake/no-network adapters and requires no provider key. Run
`npm run tutor:test:agent-live` only with `GLIDELINGO_TUTOR_ENABLED=true` and `OPENAI_API_KEY` set;
it executes the stable cases in `services/lesson-tutor/evals/lesson_tutor/cases.json`. Never put the
provider key or pseudonym key in an `EXPO_PUBLIC_` variable.

Shared-environment activation is intentionally gated. Before enabling either server flag, confirm
the tutor guard migration and retention job, immutable Secret Manager versions, Clerk verification,
private Cloud Run IAM, active server-owned RevenueCat authorization, and a real provider
spend-control policy. Enable the private flag first, the public gateway second, and the client flag
last. See [`infra/gcp/README.md`](infra/gcp/README.md) for the rollout and environment boundaries.

Stop the project database without deleting its named volume:

```bash
npm run db:down
```

## Run the macOS desktop app

From the project directory, run:

```bash
npm run desktop
```

This starts the Expo web development server on `localhost:8081`, waits for it to be ready, and opens GlideLingo in Electron. Edits refresh in the Electron window during development. Closing the window also stops the paired Expo server.

The desktop shell is intentionally small and secure: renderer Node integration is disabled, context isolation and Chromium sandboxing are enabled, permissions are denied until a feature explicitly needs one, external navigation is restricted, and packaged files use the private `glidelingo://` protocol.

To see Android or iOS and Electron update together, share one Metro server between them:

```bash
# Terminal 1
npm start
# Press a for Android or i for iOS.

# Terminal 2
npm run desktop:window
```

Both clients load the same routes and shared components. Platform-specific files are selected only where the native and web experiences need to differ.

## Build a real `.app`

Create an unpacked macOS application for local testing:

```bash
npm run desktop:package
open release/mac-arm64/GlideLingo.app
```

Create an unsigned universal `.app` for packaging checks:

```bash
npm run desktop:package:dry-run
```

Create a public-release candidate only after the production API origin and Apple credentials are configured:

```bash
npm run desktop:release
```

Dry-run artifacts are placed in `release-dry-run/`; configured distribution and release artifacts use `release/`. The release command refuses to build without exact HTTPS production API and Clerk origins, public Clerk and RevenueCat Web keys, a real Developer ID signature, and complete notarization credentials. It produces one universal app for Intel and Apple Silicon Macs and embeds only the exact configured API and Clerk origins in Electron's Content Security Policy. See [`docs/infra/DESKTOP-RELEASE.md`](docs/infra/DESKTOP-RELEASE.md) for credential setup, GitHub configuration, verification, and publishing.

## Useful checks

```bash
npm run diagnose
npm run verify
npm run api:verify
npm run tutor:verify
npm run verify:full-stack
npm run doctor
npm run test:desktop
npm run verify:full
```

If something basic does not start, use this order:

1. Run `npm run diagnose` and resolve the first missing prerequisite.
2. If Metro is already running on port 8081, reuse it with `npm run desktop:window` instead of starting another server.
3. If Metro appears stale, run `npm run start:clear` or `npm run desktop:clear` once.
4. Run `npm run doctor` for Expo dependency or configuration mismatches.
5. Fix the first causal error before chasing later errors.

## Codex and AI agent skills

GlideLingo is configured for both Codex and Cursor coding agents:

- **Durable Instructions (`AGENTS.md`)**: Automatically loaded by Codex/Cursor with repository rules, platform boundaries, and verification gates.
- **Repository Skill (`.agents/skills/expo-electron/SKILL.md`)**: Specialized guide for Expo SDK 57, React Native 0.86, Expo Router, and Electron architecture, commands, and platform file conventions.
- **Deslopify Skill (`.agents/skills/deslopify/SKILL.md`)**: Evidence-first cleanup of stale PRs, documentation drift, duplicate sources of truth, dead paths, and accidental complexity without weakening intentional safeguards.
- **Learning Behavior Skill (`.agents/skills/learning-behavior-design/SKILL.md`)**: Research-backed guidance for emotional UX, ethical gamification, retention mechanics, celebrations, streaks, notifications, and behavior experiments without confusing engagement with learning.
- **Design System (`DESIGN_SYSTEM.md`)**: Complete token guidance (`src/constants/theme.ts`) and component kit usage (`ThemedText`, `GlideSurface`, `GlideButton`, `GlideSymbol`, `GlideSwitch`, `ProgressBar`).
- **Codex Actions (`.codex/environments/environment.toml`)**: Exposes one-click app actions in the Codex desktop app (`Run Expo`, `Run iOS`, `Run Android`, `Run Web`, `Run Desktop`, `Verify`, `Diagnose`, `Expo Doctor`).
- **Lifecycle Workflows (`~/.agents/skills/`)**: Supports standard engineering skills including `$dev-build-feature`, `$dev-debug-issue`, `$dev-plan-feature`, `$dev-review-change`, `$application-architecture`, and `$agent-parity`.

The same entrypoint works from a terminal:

```bash
./script/build_and_run.sh --help
./script/build_and_run.sh
```

## Builds and app stores

Expo Application Services (EAS) handles signed development and store builds. Keep it project-local too:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
```

Do this only when the app needs a standalone development build or you are ready to prepare TestFlight/Google Play artifacts. Expo Go is enough for the first learning loop unless a dependency requires custom native code.

## References

- [Expo project setup](https://docs.expo.dev/get-started/create-a-project/)
- [Android emulator setup](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS Simulator setup](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Router](https://docs.expo.dev/router/introduction/)
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
