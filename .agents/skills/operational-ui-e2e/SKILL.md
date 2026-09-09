---
name: operational-ui-e2e
description: Autonomously prove and, when authorized, repair user-facing behavior in the exact Expo web and Electron PR/worktree through real visible interactions, correlated runtime evidence, and repeatable Playwright journeys. Use for functional walkthroughs, UI completion, runtime acceptance, cross-runtime regressions, or establishing the missing standard E2E harness; do not use as a substitute for unit, API, export, or process-start smoke tests.
---

# Operational UI E2E

Replace the routine human functional walkthrough with a reproducible, observable run against the
exact code under review. A pass means the changed outcome was reached through visible controls in
both Expo web and Electron. Compilation, unit tests, API probes, exports, screenshots, and opening
a window are prerequisites or evidence fragments, never substitutes.

Read [references/walkthrough-runbook.md](references/walkthrough-runbook.md) for every run. Read
[references/vendor-testing.md](references/vendor-testing.md) before selecting or changing tooling,
[references/harness-contract.md](references/harness-contract.md) when the standard harness is
missing or changing, and [references/interaction-evidence.md](references/interaction-evidence.md)
before defining or reporting the run. Read [references/qualification.md](references/qualification.md)
when changing this skill or claiming it is operationally proven.

## Select one operating mode

- Walkthrough: execute and report; product and harness files remain read-only.
- Diagnose: reproduce, correlate evidence, and prove the cause; do not fix.
- Fix: diagnose, make the smallest authorized product correction, and rerun the failed journey.
- Establish harness: add or repair the smallest vendor-aligned Playwright harness, then prove one
  meaningful web/Electron vertical slice. Use only when the user asked to build, complete, or fix
  testing infrastructure.

Disposable runtime artifacts are allowed in every mode. Do not push, merge, retarget a PR, change
branch protection, alter production, erase real user data, or use a paid service without matching
authorization.

## Non-negotiable gates

1. Exact lane: record the repository, owning worktree, branch, immutable SHA, dirty state, PR head,
   and their alignment before attributing a result.
2. Real entry: start from a declared state and reach behavior through visible controls. A direct
   final URL, API mutation, DOM injection, or hidden application RPC cannot prove the journey.
3. Two real runtimes: run the shared journey in Expo web and the actual Electron BrowserWindow.
   Add packaged Electron only when the changed boundary differs from development.
4. Observable execution: attach browser, renderer, Electron main-process, Expo/Metro, and relevant
   service observations before interacting.
5. Security parity: preserve production BrowserWindow security. Never pass --no-sandbox, disable
   webSecurity, bypass CSP, enable Node integration, or weaken context isolation to make a test
   work.
6. Isolated state: each journey owns its account/data/profile and teardown. A retry must not depend
   on residue from a prior attempt.
7. No false green: a missing capability is blocked, a skipped target is untested, and a flaky
   first attempt remains flaky even if a configured CI retry passes.

## Define the acceptance graph

Map the changed outcome before choosing tests:

    starting state -> visible entry -> user action -> route/component -> state owner
                   -> API or IPC boundary -> persistence/external effect -> visible confirmation
                   -> expected failure -> visible recovery

Label meaningful edges as triggers, reads, writes, guards, retries, or recovers. Cover the smallest
journey set that crosses every changed or high-risk edge, including one realistic failure/recovery
path when that behavior changed. A desktop change must include its affected preload, IPC, protocol,
window, persistence, updater, permission, or navigation edge.

## Execute the evidence loop

1. Orient: inspect AGENTS.md, package scripts, Git worktrees, PR metadata, dependency versions,
   existing E2E configuration, and the changed files. Never borrow commands from another branch.
2. Specify: write the acceptance graph, starting state, visible actions, outcome assertions,
   side-effect assertions, negative path, and required observations before launch.
3. Preflight: verify dependencies, ports, credentials, test data, supported OS, build freshness,
   and harness capability. Resolve the owner of a port or process before stopping it.
4. Observe: keep services in persistent terminals and subscribe to errors, failed requests,
   console output, crashes, process exits, and relevant request IDs before the first action.
5. Interact: drive the browser and Electron renderer using Playwright user-facing locators,
   auto-waiting, and web-first assertions. Exercise intermediate loading and recovery states.
6. Correlate: tie every visible transition to timestamped runtime evidence and the intended
   state/API/IPC effect. A screenshot without this chain is insufficient.
7. Classify: distinguish product defect, harness defect, environment defect, unsupported
   capability, and flaky/non-deterministic behavior before changing anything.
8. Repair when authorized: prove the earliest causal error, make one coherent correction, add the
   narrowest useful regression, and rerun from a fresh isolated state.
9. Expand verification: rerun the exact failure first, its counterpart runtime second, affected
   checks third, then repository-required broader verification.
10. Report: use the evidence packet and give separate automated, web, Electron, and packaged
    verdicts for the tested SHA.

Use the active worktree's package scripts and Playwright setup. Standard behavior means public
Playwright APIs, semantic locators, bounded event-driven waits, isolated fixtures, guaranteed
teardown, and failure-only trace/screenshot/video. Do not add fixed sleeps, unbounded polling,
force clicks, private Playwright internals, custom app drivers, or success-only test-mode branches.

## Handle a missing or broken harness honestly

In Walkthrough or Diagnose mode, inventory the absent capability and mark the corresponding gate
blocked; do not silently install packages or substitute manual claims. Continue every other safe
gate so the report is useful.

In Establish harness or authorized Fix mode, follow the harness contract. Keep the Expo application
suite separate from any public Astro website suite, pin versions in the lockfile, preserve Electron
security flags, serialize Electron workers when shared process state requires it, and prove a
meaningful navigation-and-outcome slice rather than launch-only smoke.

If Playwright Electron cannot cover a required OS-owned dialog or handoff, prove the app-owned
behavior up to and after that boundary with a controlled stub when valid, then report the OS-owned
step separately. Do not claim fully autonomous coverage for an unautomated native step.

## Recover from failures

Capture the first failing transition and earliest causal evidence. Rank hypotheses and run the
smallest discriminating check. Do not change multiple suspected causes at once or repeatedly clear
caches to conceal a readiness problem.

Local confirmation runs use zero retries so failures remain visible. A CI harness may use one retry
to collect evidence, but any first-attempt failure is classified and reported as flaky until the
cause is removed. If the same external blocking condition survives three evidence-backed attempts,
stop modifying code and report the blocker and the single next action.

## Compose only the workflow that is needed

- Use $pr-integration-orchestrator in Map or Rehearse mode when it is installed and multiple PRs
  or worktrees must be ordered. Otherwise use Git and GitHub CLI directly.
- Use $dev-map-feature only when the journey or state ownership cannot be established from bounded
  inspection.
- Use $dev-debug-issue after a reproducible failure needs causal diagnosis.
- Use $expo-electron for repository-specific Expo/Electron build and runtime conventions.
- Use browser control for exploratory reproduction; promote stable coverage into the repository
  Playwright suite.

This skill owns the cross-runtime acceptance gate. Routed workflows supply only missing mapping,
diagnosis, or platform context.

## Qualify the skill itself

Parser validation proves only that the skill can load. After changing its runtime or evidence
contract, execute the qualification matrix: one expected-red visible assertion with artifacts,
controlled browser and Electron observer failures, one real shared journey in both runtimes, a
fresh-state repeat, and cleanup/secret checks. Record harness defects discovered and rerun after
each correction. Do not call the skill fully tested while any applicable qualification gate is
untested, flaky, or merely documented.

## Completion contract

Pass only when, at the recorded SHA:

- required automated prerequisites pass;
- the selected outcome completes through visible controls in Expo web and Electron;
- affected desktop-only and packaged behavior passes where applicable;
- expected state/API/IPC effects satisfy their contract without unexpected duplication;
- no unexplained console error, stack trace, failed request, unhandled rejection, crash, or process
  leak occurred;
- artifacts and the interaction ledger make the run reproducible;
- the final edit, if any, is covered and the real journey was rerun afterward.

Report passed, failed, blocked, or not applicable separately for prerequisites, web, Electron, and
packaged Electron. Name the supported target OS. End with remaining human steps: none, or the exact
OS-owned action that could not be automated. Never collapse an untested runtime into a general
green verdict.
