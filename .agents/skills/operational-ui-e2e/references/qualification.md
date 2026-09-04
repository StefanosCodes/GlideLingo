# Operational qualification

Use this matrix after changing the skill, harness contract, runner, runtime versions, or core
observability. Qualification must exercise the workflow; linting or parser validation is level
zero, not operational proof.

## Qualification levels

| Level | Required evidence | Permitted claim |
| --- | --- | --- |
| 0. Structural | Skill validator, metadata parse, links, and diff checks | Loads successfully |
| 1. Decision | Exact-lane, dirty/stale lane, missing harness, port owner, and unsupported boundary decisions | Preflight logic exercised |
| 2. Harness | Expected-red assertion, failure artifacts, observer self-tests, and secret scan | Harness detects controlled failures |
| 3. Runtime | Real shared journey passes in Expo web and Electron twice from isolated state with clean teardown | Locally operationally qualified |
| 4. Enforced | Supported-OS CI job repeats the journey and is a required check | Merge-gate enforced |

Never report a higher level than the evidence supports.

## Scenario matrix

### Lane and capability

- Dirty unrelated checkout: select an isolated lane without stashing, cleaning, or overwriting.
- Active PR/worktree match: compare local and remote immutable heads.
- Stale or missing PR metadata: scope the result locally and refuse remote attribution.
- Missing root harness with a separate website suite: enter Establish harness mode; never reuse the
  website verdict.
- Occupied port: identify the owner. Select a repository-supported isolated/exported path or block.
- Host-binding mismatch: verify the readiness hostname actually reaches the bound listener.
- Build-time environment switch: prove that the web development key and production Electron key
  are isolated, and clear Expo's transform cache before accepting the production export.

### Expected-red evidence

Run an explicitly controlled missing visible outcome. It must:

- exit non-zero with zero retries;
- identify the first failed visible assertion;
- retain trace, screenshot, error context, and configured video;
- attach runtime observations;
- contain no credentials, tokens, cookies, or private data.

The expected-red test is a qualification probe and must be skipped in the normal green gate.

### Observer self-tests

In separate qualification-only tests, inject unique controlled markers and assert capture of:

- browser renderer exception;
- browser failed request;
- Electron main-process error;
- Electron renderer exception;
- unexpected Electron exit or crash when safely reproducible.

Use public APIs and event-driven polling. These injections test the observer and cannot count as
product acceptance.

### Real journey

Choose a deterministic, meaningful journey that starts from visible UI, exercises at least one
guard or recovery state, navigates through the application, and verifies visible and state effects.
Run the same journey in Expo web and the real Electron BrowserWindow. Verify production security
properties through public runtime observations and repository tests.

Run the final green journey twice with fresh browser context, Electron profile, and test data. Use
zero local retries. Any first-attempt failure remains a qualification failure until explained and
corrected.

### Cleanup and reporting

After each run, prove:

- no owned web server, Electron process, port listener, or temporary profile remains;
- another worktree's processes were not stopped or reused;
- reports and artifacts contain no recognizable secret patterns;
- generated artifact directories are ignored;
- every failure and correction is present in the attempt ledger.

## CI qualification

Run the green gate on the Electron packaging OS with the pinned Node, Playwright, Expo, and Electron
versions. Install the pinned browser, provide disposable public/test configuration through masked
CI values, upload artifacts on failure, and fail when either runtime is failed, blocked, or
untested. Requiring the check in branch protection remains a separately authorized remote action.
