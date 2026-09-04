# Vendor-aligned testing choices

Consult these sources before changing the harness. Repository-pinned versions and commands govern
an established compatible implementation; current vendor documentation governs new design.

## Official sources and conclusions

### Expo

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) anchors commands and APIs to this
  repository's SDK line.
- [Develop websites with Expo](https://docs.expo.dev/workflow/web/) defines Expo CLI as the real web
  development/export path. Test the running Expo application, not a component surrogate.
- [Expo unit testing](https://docs.expo.dev/develop/unit-testing/) treats unit/component coverage as
  complementary and recommends E2E coverage for UI behavior instead of snapshot confidence.
- [Expo E2E with Maestro](https://docs.expo.dev/eas/workflows/examples/e2e-tests/) targets built
  native iOS/Android artifacts. It is the native-mobile route, not the Expo web or Electron runner.

### Electron

- [Electron automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
  intentionally lists standard external solutions rather than an Electron-owned custom framework.
  It documents Playwright, WebdriverIO, and Selenium; Playwright is the default here because one
  locator/assertion model can drive Expo web and Electron's renderer.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) and
  [Electron process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) make
  context isolation, sandboxing, web security, bounded navigation, and safe IPC production
  properties. Testing must not weaken them.
- [Electron main-process debugging](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
  supports observable main-process failures; it is not a replacement for renderer interaction.

### Playwright

- [Electron API](https://playwright.dev/docs/api/class-electron) supplies _electron.launch.
  chromiumSandbox defaults off, so this repository must explicitly enable it. bypassCSP stays off.
- [ElectronApplication API](https://playwright.dev/docs/api/class-electronapplication) supplies the
  process, context, first window, window events, console events, and main-process evaluation.
- [Best practices](https://playwright.dev/docs/best-practices) require user-visible behavior,
  isolated tests, user-facing locators, controlled external boundaries, and web-first assertions.
- [Auto-waiting](https://playwright.dev/docs/actionability) replaces fixed sleeps and forced
  actions with observable actionability checks.
- [Fixtures](https://playwright.dev/docs/test-fixtures), [web server](https://playwright.dev/docs/test-webserver),
  [projects](https://playwright.dev/docs/test-projects), [authentication](https://playwright.dev/docs/auth),
  [timeouts](https://playwright.dev/docs/test-timeouts), and [reporters](https://playwright.dev/docs/test-reporters)
  provide the standard lifecycle, isolation, orchestration, secret handling, bounds, and evidence.

Playwright marks Electron support experimental and does not intercept native Electron dialogs.
Pin the Playwright/Electron pair, prove compatibility, and report OS-owned UI separately.

## Repository decision

| Boundary | Standard tool | Operational proof |
| --- | --- | --- |
| Pure logic/component | jest-expo and React Native Testing Library | Fast deterministic contract, not a launched journey |
| Expo application web | Expo CLI plus Playwright Page | Real React Native Web navigation, controls, requests, and outcome |
| Electron application | Playwright _electron plus ElectronApplication | Real main process, BrowserWindow renderer, and app-owned desktop edges |
| Native iOS/Android | Expo-documented Maestro on built app | Installed simulator/emulator behavior, outside this skill unless requested |
| OS-owned dialogs/handoffs | Platform automation or explicit residual step | Native behavior Playwright Electron cannot control |

The public Astro website has its own Playwright configuration. It remains a separate suite and does
not satisfy the Expo application web or Electron gate.

Use WebdriverIO only when an existing lane already standardizes on it or a proven Playwright
limitation blocks a required Electron boundary. Do not maintain multiple runners speculatively.

## Open-source cross-checks

- [magnus919/agent-skills Playwright skill](https://github.com/magnus919/agent-skills/blob/main/playwright/SKILL.md)
  reinforces suite-first inspection, user-facing locators, isolated state, controlled external
  boundaries, and bounded artifacts.
- [Expo CLI testing notes](https://github.com/expo/expo/blob/main/packages/%40expo/cli/README.md)
  emphasize reliable E2E behavior and isolated temporary projects.
- [Expo bare app E2E notes](https://github.com/expo/expo/blob/main/apps/bare-expo/e2e/README.md)
  reinforce independent starting state and retaining failure artifacts.

These repositories are pattern checks, not authority over the official vendor docs or this
repository's contracts. Reuse their proven principles; do not copy opaque commands or frameworks.
