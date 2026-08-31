---
name: pr-integration-orchestrator
description: Map, review, rehearse, and safely integrate multiple dependent or overlapping GlideLingo pull requests across branches and worktrees. Use when asked to understand the PR queue, determine merge order, coordinate parallel reviewers, prepare an integration branch, retarget stacked PRs, or execute an approved merge train; do not use for one isolated PR review.
---

# PR Integration Orchestrator

Turn a scattered set of PRs, branches, worktrees, and chat-produced changes into one live,
dependency-safe integration plan. The primary agent owns the plan, product decisions, integration
result, and final evidence.

Read [references/review-packet.md](references/review-packet.md) when preparing reviewer tasks,
the queue board, or the merge packet.

## Select the operating mode

- **Map:** inventory and explain the queue. Remain read-only.
- **Plan:** recommend dependency order, review waves, and gates. Remain read-only.
- **Rehearse:** create an isolated local integration worktree and test the proposed order. Do not
  push or alter remote PRs unless the user asks.
- **Integrate:** retarget, update, or merge remote PRs only after explicit authorization for those
  external mutations.

Do not treat a request for an integration plan or senior review as permission to merge. Deleting
branches or worktrees, force-pushing, bypassing branch protection, enabling a feature, deploying
production, or publishing a release always requires matching authority.

## Reconstruct the live queue

Refresh evidence at the beginning of every run. Do not trust an earlier chat, saved queue, PR body,
or previous green check as current state.

Use this source order:

1. live GitHub PR metadata, including state, draft status, base, head, head SHA, mergeability,
   checks, reviews, unresolved threads, labels, and declared dependencies;
2. Git history and comparisons for actual ancestry, commits, files, lockfiles, migrations,
   workflows, configuration, and overlapping symbols;
3. local branches and worktrees for unpushed or not-yet-PR work when the user asks for the full
   queue;
4. repository instructions, architecture documents, tests, and deployment state;
5. chat summaries only as discovery leads that must be verified elsewhere.

For every candidate, identify:

- intended outcome and scope exclusions;
- current base and intended base;
- whether its visible diff contains prerequisite commits;
- touched subsystems and state owners;
- checks and review status at the current head SHA;
- secrets, migrations, flags, infrastructure, external accounts, or live acceptance gates;
- overlap with every other candidate that could affect merge order.

Review a stacked PR against its intended parent, not against `main` when that would mix the
parent's changes into the review. A PR that accidentally includes upstream commits is not ready
for senior review until its base or history is corrected.

## Classify relationships precisely

Build a directed acyclic graph from confirmed relationships. Keep these relationship types
separate:

- **Code dependency:** the branch imports, calls, extends, or assumes code introduced elsewhere.
- **Data/contract dependency:** schemas, migrations, API contracts, identity, or state ownership
  must land in a particular order.
- **Operational dependency:** infrastructure, credentials, environments, or release lanes must
  exist before deployment.
- **Enablement dependency:** code may merge disabled, but a flag or public rollout must wait for a
  later control.
- **Overlap risk:** no semantic dependency is proven, but both changes touch the same files,
  lockfiles, generated output, routes, configuration, or user journey.

Do not invent a hard dependency merely because one PR was created first. Conversely, do not call
two PRs independent merely because Git can merge them without textual conflicts. Surface cycles
or contradictory ownership as decisions for the primary agent or user.

## Score readiness on separate axes

Do not collapse readiness into one green/red value:

| Axis | Ready means |
| --- | --- |
| Code | Intended diff is coherent, reviewed, tested, and green at the current head. |
| Integration | Dependencies are merged or fixed, the base is current, and overlaps are reconciled. |
| Operational | Required secrets, infrastructure, migrations, monitoring, rollback, and smoke checks exist. |
| Enablement | Product, safety, billing, identity, privacy, and real-device/live gates required for exposure pass. |

A PR can be safe to merge while still unsafe to deploy or enable. State that distinction
explicitly.

## Delegate only independent evidence work

The primary agent frames the dependency graph before delegation and normally uses no more than
three concurrent subagents. Give each agent a bounded objective, exact PRs or files, intended base,
known constraints, evidence required, output format, and done condition.

Good parallel workstreams are:

- a read-only dependency and overlap mapper;
- a read-only principal reviewer for the next consequential merge candidate;
- a read-only CI, test, migration, or deployment-evidence analyst.

Use one writer for any overlapping code area. Do not send multiple agents the same broad “review
everything” request, delegate unresolved product decisions, or accept an agent verdict without
checking its evidence. Use the task templates in the reference file.

## Design the merge train

Propose waves rather than one undifferentiated list:

1. land proven shared foundations and contracts before their consumers;
2. merge the parent of a stacked branch before its child, then retarget or rebase the child and
   rerun its complete checks;
3. sequence additive migrations before readers/writers and destructive contraction only after
   compatibility is proven;
4. allow genuinely independent candidates to be reviewed in parallel;
5. keep deployment or feature enablement as separate gates when code can safely remain disabled;
6. place a senior review immediately before each consequential candidate's merge gate, after its
   intended diff is clean.

Choose the exact order from evidence. “Infrastructure first” or “authentication first” is not a
universal rule; it is correct only when the graph and rollout contract support it.

## Rehearse integration safely

For a consequential queue, create an isolated worktree from a freshly fetched target branch.
Preserve all existing worktrees and user changes.

1. Detect ancestry and likely collisions with read-only comparisons first.
2. Apply candidates locally in the proposed order on a disposable integration branch.
3. Stop at the first conflict, contract break, migration ambiguity, or failing gate.
4. Assign each conflict to one owner and resolve it once at the correct layer; do not duplicate
   incompatible fixes across source branches.
5. Run verification from cheapest to most expensive after each meaningful boundary, then run the
   full integrated suite and actual browser/runtime journeys at the final head.
6. Record the exact candidate SHAs, commands, results, unresolved risks, and resulting integration
   SHA.

Do not push the rehearsal branch unless the user asks. A successful rehearsal is evidence, not
permission to merge.

## Apply the merge gate

Before recommending or performing each merge, confirm:

- intended base and diff are clean;
- required ancestors are merged and the head is not stale;
- current-head CI and required reviews pass, with no unresolved blocking threads;
- security, identity, tenant ownership, billing, secrets, and privacy boundaries remain correct;
- data and API changes support mixed versions and rollback where relevant;
- deployment configuration, feature flags, monitoring, and smoke checks match the rollout stage;
- the integration rehearsal covered material cross-PR interactions;
- the user has authorized the specific remote mutation.

Re-fetch immediately before a remote merge. Merge one candidate at a time, observe the actual
result, retarget or refresh dependents, and wait for their new checks. Stop the train when evidence
changes; do not batch through a failed assumption.

After the final merge, run the integrated end-to-end checks and distinguish repository completion
from deployment, store-release, and feature-enablement completion.

## Required output

Return:

1. an as-of timestamp and immutable head SHAs;
2. a queue board with readiness axes, dependencies, overlaps, blockers, and next action;
3. a dependency DAG and proposed merge waves;
4. parallel review assignments and their join point;
5. per-merge gates and verification commands;
6. decisions or approvals still needed;
7. after execution, the merge/deployment evidence and remaining enablement gates.

Lead with the recommended next action. Never hide uncertainty behind “all green.”
