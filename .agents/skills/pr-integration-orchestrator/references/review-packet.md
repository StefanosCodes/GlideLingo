# Review and integration packet

Use these structures when the queue is large enough that consistent handoffs matter. Adapt fields
to the actual repository; do not fill unknowns with guesses.

## Queue board

| Candidate | Head SHA | Intended base | Role | Confirmed dependencies | Overlap risks | Code | Integration | Operational | Enablement | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Use `ready`, `blocked`, `needs evidence`, or `not applicable` for each readiness axis, followed by
the shortest useful reason.

## Dependency graph notation

```text
#parent ──code/data──▶ #child
#infra  ─operational─▶ deployment of #feature
#auth   ─enablement──▶ public rollout of #feature
```

Dashed operational or enablement edges do not necessarily prevent a code merge. Put textual
overlap in the board unless it creates a real ordering constraint.

## Read-only dependency mapper task

```text
Objective: Map the integration relationships among <PRs/branches> against <target branch>.
Scope: Inspect live PR metadata, ancestry, commits, file/symbol overlap, migrations, lockfiles,
workflows, configuration, and declared dependencies. Do not edit files or mutate GitHub.
Known facts: <facts already verified by the primary agent>.
Constraints: Distinguish code, data/contract, operational, enablement, and overlap relationships.
Do not infer dependency from creation time or a conflict-free merge.
Evidence required: Exact refs/SHAs and file or contract evidence for every claimed edge.
Output: Proposed DAG, overlap matrix, contradictions, and the smallest set of ordering decisions.
Done when: Every candidate has an intended base and every claimed dependency is evidenced.
```

## Read-only principal reviewer task

```text
Objective: Perform the senior pre-merge review of <candidate> at <head SHA> against <intended base>.
Scope: Review only the candidate's intended diff plus the contracts it changes. Do not edit,
approve, retarget, or merge the PR.
Known integration context: <upstream dependencies, downstream consumers, rollout stage>.
Review dimensions: Correctness, architecture fit, security/tenant isolation, data integrity,
backward compatibility, concurrency/reliability, performance, observability, tests, UX, and
operational rollback where applicable.
Evidence required: Findings with severity, exact file/line or contract evidence, failure scenario,
and a concrete correction. Separate blocking findings from follow-ups.
Output: Findings first, then assumptions, verification gaps, and verdict: ready / ready after
specified fixes / not ready.
Done when: The intended diff is fully covered and the verdict follows from cited evidence.
```

## Read-only verification analyst task

```text
Objective: Validate the evidence for <candidate or integration head> without changing production
or editing source.
Scope: Inspect current-head CI, job logs, test selection, migration behavior, deployment checks,
and missing runtime coverage. Run permitted non-destructive checks in the assigned isolated
worktree when useful.
Known risks: <specific integration or rollout risks>.
Evidence required: Exact workflow run/head SHA, commands or job steps, pass/fail output, skipped
coverage, and whether results exercise the claimed acceptance criteria.
Output: Evidence table, untested risks, and the minimum next verification step.
Done when: Every claimed gate is confirmed, disproven, or explicitly marked unknown.
```

## Merge wave packet

```text
Wave: <number and purpose>
Candidates: <ordered list or explicitly parallel set>
Entry criteria: <merged ancestors, clean bases, approvals, secrets/config>
Per-candidate checks: <repository commands and live checks>
Cross-PR journeys: <actual end-to-end flows>
Stop conditions: <conflict, stale head, failed check, migration ambiguity, safety regression>
Remote actions authorized: <none or exact actions>
Exit evidence: <merged SHAs, CI runs, deployment revisions, smoke results>
Downstream updates: <retarget/rebase/rerun/review actions>
```

## Final synthesis

End with four separate statements:

- **Merged:** what is now in the target branch.
- **Deployed:** what is running and where it was verified.
- **Enabled:** what users can actually access.
- **Still gated:** remaining credentials, stores, safety checks, migrations, reviews, or product
  decisions.
