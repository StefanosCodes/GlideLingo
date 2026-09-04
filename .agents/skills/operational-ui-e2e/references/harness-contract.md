# Standard harness contract

Read this only when establishing, repairing, or deliberately changing the E2E harness. Prefer the
active repository's valid implementation when it already satisfies the contract.

## Product boundaries

The root Expo application needs its own Playwright configuration and tests. A Playwright suite for
the separate Astro public website remains independent and cannot be extended as if it launched the
Expo application. Shared helper code is acceptable only when it does not couple their servers,
state, or verdicts.

## Minimum implementation

- Add a repository-pinned @playwright/test development dependency through npm and update the
  package-lock with only the dependency graph changes required for the harness.
- Add explicit scripts for Expo web E2E, Electron E2E, and their combined functional gate.
- Use a Playwright webServer entry that calls the repository's Expo web script and waits on a
  deterministic URL whose hostname matches the actual bind address. In multi-worktree use, default
  to an isolated port and do not reuse an unrelated existing server. When Electron security
  intentionally pins a development port, use a fresh exported/packaged path instead of weakening
  validation or stopping another lane.
- Configure bounded test, action, navigation, assertion, web-server, and teardown timeouts.
- Set forbidOnly in CI. Use zero retries locally and at most one evidence-collecting retry in CI;
  keep any first-attempt failure visible in the report.
- Put HTML/machine-readable results, traces, screenshots, and video under ignored artifact paths.
  Put reusable authentication state under an ignored playwright/.auth-style path and treat it as a
  credential.
- Give the Electron project an installed Electron compatibility check, an explicit working
  directory, controlled environment, isolated user-data directory, and one worker when shared
  application/process state makes parallelism unsafe.
- Fail preflight when required local or CI configuration is missing. Keep localhost web test
  configuration separate from production-origin Electron export configuration: providers may
  reject a production key on localhost, while a production CSP must reject development origins.
  Clear the Expo transform cache when switching public build-time configuration. Inject only the
  exact non-secret/public test configuration needed for the journey and never print its value.
- Close pages, ElectronApplication, child processes, servers, temporary profiles, and test data in
  guaranteed teardown, including failed tests and signals.

The first vertical slice must do more than launch. It must enter through a visible control, perform
a meaningful user action, assert the visible outcome, and verify the intended state/API/IPC effect
in both Expo web and Electron.

## Electron launch and security

Use the public Playwright _electron.launch API and obtain the renderer through firstWindow or the
documented window event. Launch with chromiumSandbox enabled and bypassCSP disabled. Never add
--no-sandbox or weaken the production BrowserWindow settings:

- contextIsolation remains enabled;
- renderer sandbox remains enabled;
- nodeIntegration remains disabled;
- webSecurity remains enabled.

Capture the ElectronApplication process, main-process console events, all opened windows, renderer
errors, and exit status. Use Electron main-process evaluation only to inspect state or stub a
native OS boundary whose behavior is outside the app. It may not navigate the renderer, mutate
application state into success, or replace a visible user action.

Playwright Electron support is experimental. Pin the tested Playwright/Electron pair and run the
minimum compatibility slice whenever either version changes. If a proven required boundary is not
supported, evaluate Electron's documented WebdriverIO route before inventing a custom driver. Do
not depend on private Playwright trace-merging APIs; attach Electron artifacts through public
reporter/test APIs.

## Locator, assertion, and state contract

- Prefer user-facing role/name/label/text locators and web-first assertions.
- Use test IDs only as stable UI contracts where semantics are insufficient.
- Use event- or assertion-driven readiness. No fixed sleeps, unbounded polling, or force actions.
- Give every test an explicit starting state and unique data/profile. Avoid order dependence.
- Mock only a boundary the application does not own. Do not mock the production behavior being
  accepted.
- Test controlled third-party handoff and return behavior without automating routine external
  provider UI. Keep any authorized live-provider check as a separate verdict.

## CI enforcement

A local skill is procedural guidance, not a merge gate. To enforce this contract, add a functional
CI job on the OS supported for Electron packaging, run the combined Expo web/Electron script,
retain failure artifacts, and fail the check when either runtime is failed, blocked, or untested.
Keep secrets masked and use disposable accounts/data.

Changing branch protection to require that job is a separate remote action and needs explicit
authorization. Until the job and required check exist, report enforcement as procedural only.

## Prohibited substitutes

The following cannot satisfy the functional gate by themselves:

- unit/component/snapshot tests;
- API requests or database inspection;
- Expo export or Electron packaging success;
- timed process-start smoke or window creation;
- screenshots without an action/state ledger;
- webContents JavaScript polling;
- application-only RPC or hidden test routes;
- a public website test for the Expo application;
- a manual claim without reproducible evidence.
