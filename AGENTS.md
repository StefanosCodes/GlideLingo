# GlideLingo repository guidance

## Project root

- Run every command from the directory containing this file and `package.json`.
- This directory is the Git root. Do not run project commands from its parent `GlideLingo/` folder.
- Use npm and the committed `package-lock.json`. Do not introduce another package manager.

## Stack and source map

- Expo SDK 57, React Native 0.86, Expo Router, and TypeScript power Android and iOS.
- Electron securely packages the Expo web output for macOS desktop.
- Routes live in `src/app`; frontend features in `src/features`; the shared API boundary in `src/api`; Electron code in `desktop`; the public FastAPI gateway in `backend`; the IAM-private OpenAI runtime in `services/lesson-tutor`; and database/cloud configuration in `infra`.
- `docs/infra/README.md` is the source of truth for the future full-stack architecture, folder ownership, feature-development flow, operations, deployment, and implementation order.
- Read the exact Expo SDK 57 documentation at https://docs.expo.dev/versions/v57.0.0/ before changing Expo APIs or configuration.

The infrastructure documents describe a target direction. Do not create illustrated folders, services, dependencies, database tables, or deployment pipelines until an authorized vertical slice needs them.

## Skills and lifecycle workflows

Codex and Cursor agents use skills to guide multiplatform development, architecture, debugging, and review:

- **Repository Skill (`.agents/skills/expo-electron/SKILL.md`)**:
  - Direct instructions for building, debugging, and packaging Expo SDK 57 + Electron.
  - Platform file conventions (`.ios.tsx`, `.android.tsx`, `.web.tsx`).
  - `@expo/ui` native isolation and Electron web bundle requirements.
- **Repository Skill (`.agents/skills/learning-behavior-design/SKILL.md`)**:
  - Evidence-backed emotional behavior design for learning journeys, gamification, retention, and lifecycle messaging.
  - Separates learning outcomes, target behavior, emotional transitions, and business outcomes.
  - Maintains GlideLingo's calm-momentum principles, ethical guardrails, research ledger, and behavior brief format.
- **Repository Skill (`.agents/skills/pr-integration-orchestrator/SKILL.md`)**:
  - Reconstructs the live PR, branch, and worktree queue instead of relying on stale chat context.
  - Builds dependency-safe merge waves, coordinates bounded parallel reviews, and rehearses integration in an isolated worktree.
  - Separates code, integration, deployment, and feature-enablement readiness and keeps remote merges approval-gated.
- **Portable Engineering Workflows (`~/.agents/skills/`)**:
  - `$dev-build-feature`: Implement or extend features using the inspect, decide, act, observe, verify loop.
  - `$dev-debug-issue`: Diagnose and fix runtime bugs with evidence, reproducible traces, and root-cause proof.
  - `$dev-plan-feature`: Break down multi-step features into vertical slices, acceptance criteria, and verification steps.
  - `$dev-review-change`: Audit diffs for correctness, design fit, security, and regressions.
  - `$application-architecture`: Plan state ownership, client storage, and component boundaries.
  - `$agent-parity`: Check or synchronize rules and skill parity across Codex and Cursor.

## Canonical commands

- Install exactly: `npm ci`
- Install backend exactly: `npm run setup:backend`
- Install private tutor exactly: `npm run setup:tutor`
- Start PostgreSQL: `npm run db:up`
- Stop PostgreSQL while preserving data: `npm run db:down`
- Start FastAPI: `npm run api`
- Start PostgreSQL, FastAPI, and interactive Expo: `npm run dev`
- Start PostgreSQL, FastAPI, and Electron: `npm run dev:desktop`
- Start interactive Expo/Metro: `npm start`
- Start Android: `npm run android`
- Start iOS: `npm run ios`
- Start web: `npm run web`
- Start Electron plus its Expo web server: `npm run desktop`
- Attach Electron to an already-running Metro server: `npm run desktop:window`
- Clear Metro and start mobile: `npm run start:clear`
- Clear Metro and start Electron: `npm run desktop:clear`
- Fast local verification: `npm run verify`
- Full Expo and desktop verification: `npm run verify:full`
- Verify the public API: `npm run api:verify`
- Verify the private tutor: `npm run tutor:verify`
- Environment report: `npm run diagnose`
- Expo dependency/configuration checks: `npm run doctor`
- Execute desktop tests: `npm run test:desktop`
- Build a local macOS app: `npm run desktop:package`
- Build desktop distribution artifacts: `npm run desktop:dist`
- Build a signed and notarized universal macOS release: `npm run desktop:release`

`package.json` scripts are the source of truth. Codex actions and documentation must call these scripts rather than duplicating command internals.

## Required verification

- Shared TypeScript/UI changes: run `npm run verify`.
- Expo dependency or configuration changes: also run `npm run doctor`.
- Electron runtime or packaging changes: also run `npm run test:desktop`, `npm run desktop:export`, and the relevant development or packaged smoke test.
- Desktop release changes: also produce a universal artifact and verify its signature, notarization ticket, Gatekeeper acceptance, and x64/arm64 slices. Never weaken `desktop:release` credential or HTTPS checks to make a build pass.
- Full release verification: run `npm run verify:full`.
- Backend changes: run `npm run api:verify`.
- Private tutor changes: run `npm run tutor:verify`.
- Database readiness or Compose changes: also run `npm run verify:full-stack`.
- Do not declare a runtime fix complete from lint or compilation alone; exercise the affected target.

## Debugging basic startup

1. Run `npm run diagnose` and read the first failed or missing prerequisite.
2. If port 8081 is occupied, identify its owner before stopping anything. Reuse it with `npm run desktop:window` when it is this project's Metro server.
3. For stale Metro state, use the appropriate `*:clear` command once (`npm run start:clear` or `npm run desktop:clear`).
4. For dependency/configuration problems, run `npm run doctor`; never use `npm audit fix --force` or downgrade Expo automatically.
5. Fix the first causal error, then rerun the narrow command before broader verification.

## Platform boundaries

- Share screens, domain logic, and components by default.
- Use `.ios.tsx`, `.android.tsx`, or `.web.tsx` only where platform behavior genuinely differs. Electron uses the web implementation.
- `@expo/ui` is native-only; never import it from code that the web/Electron bundle resolves without a `.web.tsx` fallback.
- Keep Electron `nodeIntegration` disabled, context isolation and sandboxing enabled, and expose future desktop-native features only through narrow validated IPC.
- Design System: Always consume semantic tokens from `src/constants/theme.ts` via `useTheme()`. Follow `DESIGN_SYSTEM.md` for typography, surface hierarchy, and component standards (`ThemedText`, `GlideSurface`, `GlideButton`, `GlideSymbol`, `GlideSwitch`, `ProgressBar`).

## Current scope

- The repository contains the clients, a public FastAPI/Cloud SQL API, verified Clerk session authentication, internal diagnostics, and a dormant authenticated lesson-tutor gateway.
- `services/lesson-tutor` owns the IAM-private OpenAI runtime. Both server flags and the client flag default off; do not enable them until the activation gates in `infra/gcp/README.md` pass.
- `backend/migrations/001_lesson_tutor_guard.sql` is a reviewed operator-run guard migration. It is not executed at application startup, and the public runtime must never receive DDL or retention `DELETE` privileges.
- Server-owned RevenueCat entitlement authorization is implemented but disabled until its migration, version-pinned secrets, signed webhooks, and sandbox acceptance gates pass. Recurring tutor retention, graded agent-evaluation thresholds, workers, and a separate production GCP environment are not implemented yet.
- Use API port `8123` and loopback-bound PostgreSQL port `55433` unless an explicit local override is documented. Check port ownership before stopping any process.
