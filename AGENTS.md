# GlideLingo repository guidance

## Project root

- Run every command from the directory containing this file and `package.json`.
- This directory is the Git root. Do not run project commands from its parent `GlideLingo/` folder.
- Use npm and the committed `package-lock.json`. Do not introduce another package manager.

## Stack and source map

- Expo SDK 57, React Native 0.86, Expo Router, and TypeScript power Android and iOS.
- Electron securely packages the Expo web output for macOS desktop.
- Routes live in `src/app`; shared UI lives in `src/components`; theme tokens in `src/constants/theme.ts`; Electron code lives in `desktop`.
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
- **Portable Engineering Workflows (`~/.agents/skills/`)**:
  - `$dev-build-feature`: Implement or extend features using the inspect, decide, act, observe, verify loop.
  - `$dev-debug-issue`: Diagnose and fix runtime bugs with evidence, reproducible traces, and root-cause proof.
  - `$dev-plan-feature`: Break down multi-step features into vertical slices, acceptance criteria, and verification steps.
  - `$dev-review-change`: Audit diffs for correctness, design fit, security, and regressions.
  - `$application-architecture`: Plan state ownership, client storage, and component boundaries.
  - `$agent-parity`: Check or synchronize rules and skill parity across Codex and Cursor.

## Canonical commands

- Install exactly: `npm ci`
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
- Environment report: `npm run diagnose`
- Expo dependency/configuration checks: `npm run doctor`
- Execute desktop tests: `npm run test:desktop`
- Build a local macOS app: `npm run desktop:package`
- Build desktop distribution artifacts: `npm run desktop:dist`

`package.json` scripts are the source of truth. Codex actions and documentation must call these scripts rather than duplicating command internals.

## Required verification

- Shared TypeScript/UI changes: run `npm run verify`.
- Expo dependency or configuration changes: also run `npm run doctor`.
- Electron runtime or packaging changes: also run `npm run test:desktop`, `npm run desktop:export`, and the relevant development or packaged smoke test.
- Full release verification: run `npm run verify:full`.
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

- This repository currently contains the client applications only. There is no backend, database, worker, or deployment service yet.
- When a backend is added, follow `docs/infra/` and document its actual setup, ports, migrations, health check, logs, and verification commands here. Expose canonical orchestration through npm scripts.
