---
name: deslopify
description: Audit and simplify GlideLingo when asked to remove slop, consolidate development or release workflows, retire stale code or documentation, or prepare a clean desktop-first development runway. Prove that an artifact is stale, duplicated, unreachable, or accidental before removing it; do not treat intentional safety machinery, tests, compatibility paths, or dormant feature gates as slop.
---

# Deslopify GlideLingo

Make the repository easier to understand and operate without erasing useful product work or
weakening release, security, and compatibility boundaries.

## Establish the target

1. Record the exact branch, SHA, dirty files, worktrees, and open pull requests.
2. State the concrete runway being simplified. Default to the current desktop-first path while
   preserving the shared Expo architecture for later iOS and Android work.
3. Read `AGENTS.md`, `package.json`, the affected runtime, tests, and the documentation that claims
   to describe it. Treat current source and observable behavior as evidence; treat old PR prose and
   forward-looking documents as hypotheses.
4. Use the review workflow for PR decisions, the debug workflow for observed defects, and the build
   workflow only when the user has authorized code changes.

## Classify before changing

Put every suspected problem in a short ledger with: artifact, evidence, classification, proposed
action, risk, and verification.

Use these classifications:

- **Drift**: documentation or configuration contradicts the current executable contract.
- **Superseded**: a PR, branch, document, or implementation has an identified successor containing
  its intended outcome.
- **Duplicate source of truth**: two active paths own the same decision or operation.
- **Dead**: code is unreachable and has no documented compatibility or dormant-feature contract.
- **Accidental complexity**: an abstraction or workflow has costs that no current requirement uses.
- **Unscoped bulk**: generated, vendored, or generic material is not required by the repository's
  current product path.
- **Boundary leak**: platform, identity, authorization, data, or release ownership is duplicated or
  bypassed across layers.

Line count, age, unfamiliarity, or a disabled feature flag is not proof of slop. Keep security
checks, release validation, regression tests, migration history, compatibility callbacks, and
explicitly dormant feature code unless evidence shows they are obsolete.

## Simplify in this order

1. Reconcile open PRs. Merge only bounded, current, verified foundation work. Close a stale stack
   only after naming its consolidated successor; preserve the branch/history.
2. Correct current-state documentation and make one operator entry point link to deeper references.
3. Remove duplicate commands in favor of canonical `package.json` scripts.
4. Simplify one coherent runtime boundary at a time. Do not combine foundation cleanup with product
   feature changes.
5. Defer large feature branches until their user journey, data ownership, and runtime acceptance can
   be reviewed independently.

Never mass-delete by filename pattern, rewrite history, prune active worktrees, reset user changes,
or mutate production merely to make the repository look smaller. Ask before destructive or external
actions not already authorized by the user.

## Preserve the GlideLingo invariants

- One Expo application owns shared routes, features, and design primitives for native and web.
- Electron packages the web implementation and exposes native behavior only through narrow,
  validated preload APIs with Node integration disabled, context isolation enabled, and sandboxing
  enabled.
- Clerk owns identity. FastAPI verifies the server-side session and authorizes protected actions.
- Local PostgreSQL, client-local state, Clerk identities, and production Cloud SQL are separate
  reset and authorization boundaries.
- `package.json` scripts are the command source of truth.
- The normal delivery cycle is focused branch → `npm run verify` → one required PR `Verify` check →
  merge → main verification → automatic API deployment.
- Installed desktop clients change only through a separately versioned, signed, notarized, accepted,
  and published GitHub Release. Drafts are invisible to the updater.
- Mobile work should reuse the same feature/API contracts; add platform files only for genuine
  capability or interaction differences.

## Verify and report

Verify from cheapest to most expensive: focused checks, `npm run verify`, affected backend or
desktop checks, export/package checks, then a visible Electron journey when user behavior changed.
Run `npm run doctor` when dependencies or Expo configuration changed and database integration when
schema or Compose behavior changed.

Finish with:

- what was removed, merged, closed, or corrected;
- concrete verification evidence;
- complexity intentionally kept and why;
- feature branches deliberately deferred;
- remaining risks or decisions, especially anything not proven through the installed desktop app.
