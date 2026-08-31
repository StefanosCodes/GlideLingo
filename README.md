# GlideLingo

GlideLingo is an Expo SDK 57 app using TypeScript and Expo Router. The same source project targets Android, iOS, web, and an Electron desktop shell.

## Infrastructure and architecture reference

The future full-stack direction, folder ownership, feature-development pattern, local operations, deployment lanes, and implementation roadmap live in [`docs/infra/README.md`](docs/infra/README.md).

Those documents distinguish the client that exists today from planned FastAPI, PostgreSQL, content, worker, and deployment infrastructure. They are architectural guidance, not a claim that future systems have already been implemented.

## Command center

Run commands from this directory—the one containing `package.json`:

| Goal | Command |
| --- | --- |
| Install the locked dependencies | `npm ci` |
| Start Expo for mobile | `npm start` |
| Open Android directly | `npm run android` |
| Open iOS directly | `npm run ios` |
| Open the Electron desktop app | `npm run desktop` |
| Check the local environment | `npm run diagnose` |
| Run lint, types, and tests | `npm run verify` |
| Run all Expo and desktop checks | `npm run verify:full` |
| Clear mobile Metro state | `npm run start:clear` |
| Clear desktop Metro state | `npm run desktop:clear` |
| Build a local macOS `.app` | `npm run desktop:package` |
| Build macOS DMG and ZIP | `npm run desktop:dist` |

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
- For a physical Android or iPhone: install a compatible Expo Go app
- For an Android emulator or local Android build: Android Studio, Android SDK 36, and JDK 17
- For the iOS Simulator or local iOS build: Xcode and an installed Simulator runtime

You do not need a global Expo CLI. Use the project-local CLI through `npx expo ...` or the npm scripts below.

## Run the starter

```bash
npm install
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

Start editing in `src/app/index.tsx`. Routes are files under `src/app`, and `src/app/_layout.tsx` owns the root navigation layout.

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

Create distributable DMG and ZIP artifacts:

```bash
npm run desktop:dist
```

Generated artifacts are placed in `release/`. Local builds can be tested on this Mac; public distribution requires Apple Developer signing and notarization.

## Useful checks

```bash
npm run diagnose
npm run verify
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
