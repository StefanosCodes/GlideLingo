# Functional walkthrough runbook

Follow these phases in order. The run is evidence collection, not a recital of commands.

## 1. Orient to the exact change

- Resolve the Git root, AGENTS.md, worktree list, current branch/SHA, dirty paths, PR base/head, and
  whether the local SHA equals the PR head.
- Read package.json, the lockfile, Electron main/preload entrypoints, Expo configuration, existing
  E2E configuration, and the affected diff.
- Treat the public Astro website and the Expo application as separate products. A website
  Playwright pass does not cover the Expo web target or Electron renderer.
- Scope every conclusion to the immutable SHA actually executed.

## 2. Define the packet before launch

Write the run identity, acceptance graph, journey matrix, negative/recovery path, expected
side-effects, target OS, and required observations. State whether packaged Electron is required.
Name any external or OS-owned boundary and how it will be controlled.

## 3. Inventory capability

Confirm that the active lane provides:

- an Expo web start command and a deterministic readiness URL;
- a Playwright browser project for the Expo application;
- an Electron launch fixture using the installed Electron entrypoint;
- isolated test state and guaranteed teardown;
- browser, renderer, main-process, and service failure collection;
- failure artifact configuration.

In Walkthrough or Diagnose mode, missing capability is a blocked gate. In Establish harness mode,
use the harness contract.

## 4. Preflight without mutation

- Install or change dependencies only when authorized.
- Check supported Node, Expo, Electron, and Playwright versions.
- Find port owners before stopping anything; never kill an unidentified shared process.
- Give each worktree its own ports when repository security contracts permit, plus its own
  temporary profile, artifact directory, and test data. If Electron restricts development to an
  occupied canonical port, use the real exported/packaged path or mark the gate blocked; never
  weaken URL validation or take another worktree's process.
- Match readiness probes and base URLs to the server's actual host binding, including IPv4 versus
  IPv6 localhost behavior.
- Detect Electron single-instance locks and stale application processes.
- Verify secrets exist without printing them. Store authentication state only in an ignored
  artifact path.
- When an external provider binds keys to origins, keep localhost web configuration separate from
  production-origin Electron configuration. Clear the Expo transform cache before switching
  public build-time values, and prove the resulting Electron response uses the production policy.
- Use a fresh build when testing packaged-only behavior.

## 5. Attach observations first

Subscribe before the first click:

- Playwright Page: console, pageerror, requestfailed, crash, response failures, trace, screenshot,
  and video when configured;
- ElectronApplication: main-process console, child process exit, first and later windows, renderer
  console/page errors, and unexpected close;
- Expo/Metro and relevant services: persistent stdout/stderr, timestamps, status, and safe request
  correlation identifiers.

Use only public Playwright reporters and attachments. Keep secrets, cookies, authorization headers,
private content, and full request bodies out of artifacts.

## 6. Walk the Expo web journey

Start the actual Expo web target from this worktree. Enter through the intended route and visible
control. Click, type, select, scroll, and use keyboard behavior as a person would. Assert
intermediate loading/disabled state, the visible final outcome, and the intended side effect.

Prefer role, accessible name, label, placeholder, or visible text locators. Use a test ID only when
semantic identity cannot express the stable control. Never use fixed delays, force clicks, DOM
mutation, or a direct final-state URL to manufacture a pass.

## 7. Walk the Electron journey

Launch the real main entrypoint with Playwright Electron. Set an explicit working directory,
controlled environment, isolated profile, bounded first-window wait, and one Electron worker when
process state is shared. Drive the returned BrowserWindow Page with the same visible actions and
assertions used for web.

The test launch must retain chromiumSandbox enabled and bypassCSP disabled. Do not pass
--no-sandbox. Do not change BrowserWindow contextIsolation, sandbox, nodeIntegration, or webSecurity
for tests. Main-process evaluation is for observation or controlled stubbing of an OS boundary,
never for injecting the application success state.

Exercise the desktop-specific changed edge. Close the application in guaranteed teardown and fail
on unexpected extra processes or windows.

## 8. Classify before repair

| Class | Evidence | Response |
| --- | --- | --- |
| Product defect | Production path violates the outcome in a reproducible state | Use evidence-first diagnosis; fix only when authorized |
| Harness defect | Locator, readiness, fixture, isolation, or teardown is wrong | Repair the harness contract without weakening assertions |
| Environment defect | Missing dependency, port collision, unsupported OS, credentials, or service | Correct the bounded environment or mark blocked |
| Unsupported capability | Standard tool cannot control the OS-owned boundary | Prove app-owned behavior and report the exact residual step |
| Flaky behavior | Same state/action produces divergent outcomes | Preserve first failure, diagnose the race, and do not call it passed |

## 9. Rerun in increasing scope

Rerun the exact failed journey locally with zero retries and fresh state. Then run the counterpart
runtime, affected automated checks, repository verification, and packaged Electron when required.
Do not use a retry as proof that the defect disappeared.

## 10. Finish with reproducible evidence

Complete the interaction packet with exact commands, versions, worktree/SHA, action ledger,
artifacts, earliest causal failures, fixes, final verdicts, residual risk, and remaining human
steps. A successful autonomous run ends with remaining human steps: none.
