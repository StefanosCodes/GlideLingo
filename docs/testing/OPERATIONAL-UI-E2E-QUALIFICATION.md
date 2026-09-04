# Operational UI E2E qualification

## Qualification identity

- As of: 2026-09-04T10:48:40-05:00
- Branch: feat/operational-ui-e2e-stress
- Base: origin/main at 0db98e547ecf38a0e715d9d1e16c5a092d83a0c6
- End-of-run origin/main: f9de28c922cbfb6ec690a195da5e3081e99df3b3 (advanced after the lane was created; not silently integrated)
- Target: the commit containing this report
- Target OS: macOS 26.2, Apple Silicon
- Runtime: Node 24.19.0, Expo 57.0.20, Electron 44, Playwright 1.62.1
- Local qualification: level 3, operationally qualified
- CI qualification: job defined; first remote run and branch-protection requirement remain pending

## Acceptance graph

    signed-out start -> visible sign-in form -> invalid email/password input -> submit
                     -> local validation guard -> visible alert
                     -> Create an account link -> visible sign-up form
                     -> Sign in link -> fresh visible sign-in form

The same path ran through Expo web and the real Electron BrowserWindow. The Electron run also
verified the exact virtual HTTPS origin and CSP response, Chromium sandbox enablement, absence of
the no-sandbox switch, and absence of renderer Node process/require globals. Existing desktop tests
verify the committed preload, URL, CSP, navigation, and packaged security contracts.

## Qualification results

| Gate | Result | Evidence |
| --- | --- | --- |
| Structural validation | Passed | Skill validator, metadata YAML, relative links, TypeScript, and diff checks |
| Dirty/wrong lane protection | Passed | Unrelated feat/lesson-tutor-agent checkout was left untouched; isolated lane created from fetched origin/main |
| End-of-run base drift | Recorded | origin/main advanced through PRs 58 and 60; desktop/main.cjs overlaps, so integration and its rerun remain a separate explicit step |
| Active PR/harness inventory | Passed | PR 58 worktree matched its remote head; root harness was absent while the separate Astro website harness was present |
| Port ownership | Passed | Port 8081 belonged to another Codex worktree and was not stopped or reused |
| Host readiness | Passed after repair | Initial 127.0.0.1 probe could not reach Expo's IPv6 localhost bind; config now uses the exact localhost origin |
| Expected-red assertion | Passed | Non-zero result at the first absent visible outcome with trace, screenshot, video, context, and observations |
| Browser observer | Passed | Captured controlled renderer exception and failed request through public Playwright events |
| Electron observer | Passed | Captured controlled main-process and renderer exceptions through public Playwright events |
| Real Expo web journey | Passed twice after final repair | Zero retries, fresh browser context, and localhost test configuration |
| Real Electron journey | Passed twice after final repair | Zero retries, cache-cleared production export, unique temporary profile, secure virtual HTTPS renderer with response CSP, guaranteed close |
| Cleanup | Passed | No owned port 8093 listener or temporary Electron profile remained |
| Artifact secrecy | Passed | No publishable-key pattern detected in test results or reports |
| Repository verification | Passed | npm ci, npm run verify, and 21/21 Expo Doctor checks |

## Failure and repair ledger

| Failure | Classification | Proven cause | Correction |
| --- | --- | --- | --- |
| npm install did not progress in sandbox | Environment | No package tree was created until network permission was granted | Repeated the locked command with narrow permission |
| Harness discovery failed | Harness | CommonJS Playwright loading rejected import.meta; environment contained undefined values; security check used a non-public API | Used CommonJS-safe path resolution, filtered string environment values, and public runtime observations |
| Expo readiness timed out | Harness/environment | Expo bound localhost over IPv6 while the probe used 127.0.0.1 | Bound the readiness and browser base URLs to localhost |
| Both real journeys failed on return to sign-in | Harness | Expo Router retained a hidden transition copy, making the otherwise correct text locator ambiguous | Kept semantic locators and filtered to visible controls instead of using first(), force, or sleeps |
| Electron document had no CSP response header | Product security defect | The custom HTTPS protocol returned the raw file response; the session web-request hook did not inject a header on that protocol response | Applied the validated production CSP directly to each protocol response and added metadata-preservation and header-injection regression coverage |
| Secure Electron reload remained in session loading | Test configuration | A cached export still embedded the localhost development Clerk origin, which the production CSP correctly blocked | Clear Expo's transform cache whenever switching to the production Electron key |
| Production key stalled Expo web on localhost | Test configuration | Clerk production keys only accept their production domain, while the web lane runs on localhost | Split the web test key from the production Electron export key and fail preflight when either is absent |
| Expo export warned before force exit | Upstream tool warning | Expo exit diagnostics showed one remaining MessagePort; the command returned zero and no child process or listener remained | Preserved and documented; matches Expo issue 43890 |

The Expo warning corresponds to the upstream
[Expo web export lifecycle issue](https://github.com/expo/expo/issues/43890). It is not treated as
an application pass/fail signal because the exported bundle completed, Expo's own watchdog returned
zero, and post-run process checks found no surviving owned resource.

## Commands

- npm ci
- npx playwright test --list
- npm run typecheck
- npm run test:e2e:stress (with distinct web-test and Electron-production public configuration)
- npm run test:e2e (twice after the final repair, with the same split configuration)
- npm run verify
- npm run doctor

The expected-red scenario is opt-in through E2E_CONTROLLED_FAILURE=1 and writes to a dedicated
qualification artifact directory. Normal functional and stress gates skip that intentional failure.
Expo web receives `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for the localhost test instance. The runner
uses `E2E_ELECTRON_CLERK_PUBLISHABLE_KEY` only to create a cache-cleared production Electron export,
then removes it from the test-process environment. Values are never written to this repository or
its reports.

## Remaining enforcement step

The macOS functional job now runs the combined Expo web/Electron command and uploads artifacts on
failure. It deliberately requires both `GLIDELINGO_CLERK_TEST_PUBLISHABLE_KEY` for localhost and the
existing production `GLIDELINGO_CLERK_PUBLISHABLE_KEY` for Electron. The test variable is not yet
provisioned, a successful remote job has not yet been observed, and making that job a required
branch-protection check is an external repository action requiring explicit authorization. Until
those steps happen, the accurate claim is locally operationally qualified, not merge-gate enforced.
