# Operational interaction evidence

Create this packet before launch and complete it during the run. Keep credentials and private user
data out of every field and artifact.

## Run identity

    As of: <timestamp and timezone>
    Repository: <root>
    Worktree: <absolute path>
    Branch: <branch or detached>
    HEAD: <immutable SHA>
    Dirty state: <clean or relevant paths>
    PR: <number, base, head SHA, URL, or unavailable>
    Local/PR alignment: <exact, stale, ahead, divergent, or unknown>
    Operating mode: <walkthrough, diagnose, fix, establish harness>
    Target OS: <OS and version>
    Runtime versions: <Node, Expo, Electron, Playwright>
    Harness status: <present, established, broken, or missing>
    Enforcement: <local/procedural or CI-required>

## Acceptance graph

| Node/edge | Source evidence | Runtime | Visible trigger or guard | State/effect | Risk |
| --- | --- | --- | --- | --- | --- |

Summarize the selected path:

    start -> visible control -> action -> loading -> boundary -> effect -> confirmation
                                     \-> expected failure -> visible recovery

## Journey matrix

| Journey | Runtime | Starting state | Visible actions | Expected outcome | Expected side effect | Required observations |
| --- | --- | --- | --- | --- | --- | --- |
| Shared happy path | Expo web | | | | | Page, Expo/Metro, service |
| Shared happy path | Electron | | | | | renderer, main process, service |
| Recovery path | applicable runtimes | | | | | first failure and recovery |
| Desktop edge | Electron dev/packaged | | | | | window/IPC/protocol/update |

Delete only genuinely inapplicable rows and state why. Sharing the web bundle does not make the
Electron row optional.

## Preflight gates

| Gate | Status | Evidence or blocker |
| --- | --- | --- |
| Exact SHA/worktree/PR alignment | ready/blocked | |
| Expo web capability and port | ready/blocked | |
| Electron launch/security parity | ready/blocked | |
| Isolated account/data/profile | ready/blocked | |
| Observability attached | ready/blocked | |
| Packaged build freshness, if required | ready/blocked/not applicable | |

## Interaction ledger

| Time | Runtime/source | User action or event | Visible state | Safe log/request evidence | Fact or interpretation |
| --- | --- | --- | --- | --- | --- |

Record facts as they happen. Quote only the shortest safe error fragment and link the full local
artifact when available.

## Failure and repair loop

| Attempt | Fresh starting state | First failing transition | Earliest causal evidence | Classification/hypothesis | Check or authorized change | Result |
| --- | --- | --- | --- | --- | --- | --- |

For changes, list affected files and regression coverage. In read-only modes write read-only
diagnosis. Preserve first-attempt failures even when a CI retry passes.

## Final verdict

| Gate | Verdict | Evidence |
| --- | --- | --- |
| Required automated checks | passed/failed/blocked | exact commands and summaries |
| Expo web real interaction | passed/failed/blocked | action sequence and artifacts |
| Electron real interaction | passed/failed/blocked | action sequence plus renderer/main evidence |
| Packaged Electron | passed/failed/blocked/not applicable | why required or not |
| CI enforcement | required/procedural/not applicable | workflow/check evidence |

End with:

- Outcome: what the user can or cannot complete at this SHA.
- Fixed: proven cause and smallest correction, or none.
- Residual risk: platforms, accounts, paths, or external boundaries not exercised.
- Remaining human steps: none, or the exact OS-owned action and why automation cannot control it.
- Next action: the single smallest action needed for any failed or blocked gate.

Never produce a general green verdict when a runtime is blocked or untested.
