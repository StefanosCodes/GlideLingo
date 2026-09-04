---
name: expo-electron
description: Build, debug, verify, and package the GlideLingo multiplatform client across Android, iOS, web, and Electron using Expo SDK 57, React Native 0.86, Expo Router, and TypeScript. Use when modifying screens, shared components, platform-specific files, Electron configuration, or verifying builds.
---

# Expo and Electron Development (GlideLingo)

GlideLingo is a single unified TypeScript codebase delivering native Android and iOS mobile experiences via Expo SDK 57 and React Native 0.86, plus a secure macOS desktop app powered by Electron wrapping the Expo web build.

## Architecture and Platform Boundaries

1. **Shared Foundation by Default:**
   - Routes reside in `src/app/` using Expo Router file-based navigation.
   - Shared UI components reside in `src/components/` and `src/components/ui/`.
   - Theme tokens reside in `src/constants/theme.ts` (Fonts, Spacing, Radii, Colors).
   - Domain logic and hooks reside in `src/hooks/` and `src/`.

2. **Platform Extensions:**
   - Use `.ios.tsx`, `.android.tsx`, or `.web.tsx` only when behavior or native APIs genuinely differ.
   - **Electron uses the Web bundle:** Any file resolved by the web target (`.web.tsx` or standard `.tsx`) is what runs inside Electron.
   - **Native-Only Isolation:** `@expo/ui` and iOS Liquid Glass are native-only. Never import them into web/Electron bundles without a corresponding `.web.tsx` or platform guard.

3. **Electron Desktop Security Model:**
   - Files reside in `desktop/` (`desktop/main.cjs`, `desktop/runtime.cjs`).
   - Renderer Node.js integration is strictly disabled (`nodeIntegration: false`).
   - Context isolation (`contextIsolation: true`) and Chromium sandbox are enabled.
   - Production packages serve bundled files from the virtual HTTPS origin `https://desktop.glidelingo.com`.
   - The `glidelingo://` protocol is reserved for validated authentication callbacks; it is not the renderer origin.
   - Dev mode loads `http://localhost:8081` served by Expo web with `BROWSER=none`.
   - A preload bridge may be present in both modes. Never use bridge presence alone to select native authentication:
     loopback HTTP(S) renderers use the web provider, while packaged renderer origins use the Electron provider.

## Canonical Commands

Always execute from the project root (where `package.json` lives):

| Workflow | Command | Purpose |
| --- | --- | --- |
| **Install** | `npm ci` | Deterministic dependency install using `package-lock.json` |
| **Mobile Dev** | `npm start` | Interactive Metro server (press `a` for Android, `i` for iOS) |
| **Android** | `npm run android` | Launch directly on Android emulator / connected device |
| **iOS** | `npm run ios` | Launch directly on iOS Simulator |
| **Web Dev** | `npm run web` | Start Expo web in default browser |
| **Desktop Dev** | `npm run desktop` | Start concurrent Expo web server (port 8081) + Electron window |
| **Desktop Window** | `npm run desktop:window` | Attach Electron to an already running Metro server on 8081 |
| **Reset Mobile** | `npm run start:clear` | Clear Metro cache and start mobile |
| **Reset Desktop** | `npm run desktop:clear` | Clear Metro cache and start Electron |
| **Fast Verify** | `npm run verify` | Run ESLint (`expo lint`), TypeScript check (`tsc --noEmit`), and desktop runtime tests |
| **Full Verify** | `npm run verify:full` | Run fast verify + `npx expo-doctor` + `expo export --platform web` |
| **Diagnose** | `npm run diagnose` | Inspect Node, npm, emulator, and port prerequisites |
| **Doctor** | `npm run doctor` | Run Expo dependency/config compatibility checks |
| **Desktop Tests** | `npm run test:desktop` | Execute Node test runner against `desktop/*.test.cjs` |
| **Package Local** | `npm run desktop:package` | Export web and package unpacked macOS app into `release/mac-arm64/` |
| **Package Layout Diagnostic** | `npm run desktop:package:dry-run` | Build an unsigned universal app layout in ignored `release-dry-run/` |
| **Package Dist** | `npm run desktop:dist` | Export web and build distributable DMG and ZIP in `release/` |
| **Release Preflight** | `npm run desktop:release:preflight` | Run the complete local gate and validate unsigned release-shaped DMG/ZIP assets before the version PR |
| **Accept Signed Draft** | `npm run desktop:release:accept-draft -- desktop-v<version>` | Download and verify the exact private GitHub draft from the tagged release checkout |

## Design System & Component Guidelines

Refer to `DESIGN_SYSTEM.md` when building UI:
- **Semantic Tokens:** Never use raw hex codes; consume semantic tokens via `useTheme()` from `src/hooks/use-theme`.
- **Core Primitives:**
  - `ThemedText`: Semantic typography roles (`headline`, `body`, `footnote`, `largeTitle`).
  - `GlideSurface`: Layered surface containers (`card`, `grouped`, `glass`, `tinted`, `success`).
  - `GlideButton`: Button component with `primary` and `secondary` variants and web hover/cursor styling.
  - `GlideSymbol`: SF Symbols on iOS with Material Symbols / web fallback.
  - `GlideSwitch`: Accessible theme-aware switch toggle with web support.
  - `ProgressBar`: Accessible progress indicator with theme tint.
- **Touch & Accessibility:** Maintain minimum 44x44pt touch targets, include `accessibilityRole` and `accessibilityState`.

## Debugging Order

When startup or runtime errors occur:
1. Run `npm run diagnose` to check prerequisites and identify port 8081 conflicts.
2. If port 8081 is already running Metro for this project, attach with `npm run desktop:window`.
3. If Metro bundle is stale or corrupt, run `npm run start:clear` or `npm run desktop:clear`.
4. Run `npm run doctor` for dependency version mismatches (never use `npm audit fix --force`).
5. Run `npm run test:desktop` if Electron window creation or runtime behavior fails.
6. Fix the first causal error before addressing downstream symptoms.

## Verification Checklist

Before considering changes complete:
- [ ] Shared TypeScript / UI changes pass `npm run verify`.
- [ ] Expo dependency or config changes pass `npm run doctor`.
- [ ] Electron changes pass `npm run test:desktop` and `npm run desktop:export`.
- [ ] Full pre-merge check passes `npm run verify:full`.
- [ ] Tested on target runtimes (mobile simulator/emulator and Electron desktop).
- [ ] Auth changes prove the complete browser and Electron lifecycle—signup, verification, persistence, sign-out,
      sign-in, recovery, and relaunch—before packaging or pushing a release branch.

For a desktop release, treat each published format as a separate consumer boundary:

- Use `desktop/package.json` as the desktop version source; keep both lockfile version fields equal,
  and reserve exactly `desktop-v<version>`. Never reuse or move a release version/tag.
- Run `desktop:release:preflight` on macOS before merging the version PR. Its unsigned development
  artifacts prove dependency, build, metadata, and architecture contracts only; never distribute them
  or claim they prove Apple signing or updates.
- Prefer electron-builder's supported signing, notarization, and target configuration over recursive post-processing of a signed `.app`.
- Verify both the DMG installer and ZIP updater payload; success of one does not prove the other.
- After the GitHub workflow stages the private draft, run `desktop:release:accept-draft` from the exact
  tagged checkout. Then install the retained DMG normally and complete the user-flow checklist.
- Keep the release private until the downloaded artifacts pass. Revoke temporary privileges in guaranteed cleanup even when a build fails; retain source credentials until the release is independently verified.
- Reject macOS release apps containing `com.apple.cs.*` extended-attribute signatures because ZIP transport does not preserve them reliably.
- Drafts are invisible to installed updaters. Only a signed, published `N → N+1` exercise proves the
  real update path; do not add an unsigned-updater bypass or local update service as a substitute.
- Changes limited to `website/` do not enter the Electron package. Expo `src/`, `desktop/`, and
  packaged-asset changes require a new desktop version when they should reach installed users.
