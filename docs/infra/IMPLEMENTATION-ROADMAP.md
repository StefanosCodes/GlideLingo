# Implementation Roadmap

## Purpose

This roadmap turns the architecture into small working slices. It is directional, not a commitment to build every listed capability immediately.

Each slice must preserve a working application and include its own verification.

[`PRODUCT.md`](../../PRODUCT.md) is the canonical V1 product contract. This roadmap sequences
infrastructure work and must not redefine product behavior.

## Current `main` snapshot

Audited at `786a1141410e01c3b2e6484d455fe4d340039820`:

- the Expo/Electron client, one authored Greek learning path, local evidence/rhythm state, and
  pre-generated Google lesson audio exist;
- the public FastAPI service has health/readiness, verified Clerk session authentication, `/v1`
  routes, and an authenticated lesson-tutor gateway;
- the IAM-private lesson-tutor service and its operator-run guard migration exist but remain dormant
  behind disabled flags;
- server-owned RevenueCat authorization exists but remains disabled until its documented migration,
  secret-version, webhook, and sandbox acceptance gates pass;
- PostgreSQL and development/release infrastructure foundations exist;
- general server-persisted learner progress, complete authored V1 curriculum, background workers,
  live OpenAI Realtime voice, and LiveAvatar presentation do not exist.

Status labels below describe this snapshot, not the age or merge state of an earlier PR.

## Slice 0: Architecture reference

Outcome:

- Humans and coding agents share one source of truth for boundaries, structure, deployment, and implementation flow.

Included:

- The documents in `docs/infra/`.
- Links from repository guidance.

Excluded:

- Backend code.
- Database infrastructure.
- Empty future feature folders.
- Deployment credentials or pipelines.

## Slice 1: Golden Greek learning mission

Status: partially implemented; one bounded Greek path and local evidence behavior exist, while the
complete authored V1 course does not.

Outcome:

- A learner can complete one coherent, reviewed Modern Greek mission on Android, iOS, and Electron.

Work:

- Replace prototype Spanish content with one Greek golden mission.
- Introduce frontend feature folders only for touched behavior.
- Keep routes thin.
- Implement a deterministic learning-session reducer.
- Build the first reusable activity renderers.
- Keep content local while validating the experience.

Acceptance:

- The same mission and rules work across mobile and desktop.
- Platform-specific code remains at narrow interaction boundaries.
- Loading is not yet remote, but lesson progress and error transitions are testable.

## Slice 2: Full-stack walking skeleton

Status: implemented as the current infrastructure foundation.

Outcome:

- A real client can call FastAPI, FastAPI can prove PostgreSQL readiness, and the full environment has canonical startup and verification commands.

Work:

- Add the minimal `backend/` application.
- Add PostgreSQL local infrastructure without unrelated services.
- Add health/liveness and database-readiness contracts.
- Add typed client configuration and one visible internal diagnostics path.
- Add backend tests and root orchestration commands.
- Re-check local port ownership during implementation.

Implemented boundaries:

- FastAPI uses port `8123` and exposes `/health/live` and `/health/ready`.
- PostgreSQL uses loopback-only host port `55433` through `infra/compose.yaml`.
- `/diagnostics` traces the real client → API → PostgreSQL readiness path.
- Root npm scripts and `.github/workflows/verify.yml` enforce repeatable local and PR verification.

Acceptance:

- Android/iOS development and Electron can reach the API with explicit environment configuration.
- Readiness fails safely when PostgreSQL is unavailable.
- Existing Expo/Electron verification remains green.

This slice proves infrastructure wiring, not learner persistence.

## Slice 3: Persistent authenticated learner

Status: partially implemented; Clerk sessions are verified server-side, but durable learner sessions,
attempt persistence, and cross-client resume are not.

Outcome:

- One learner can sign in, start a lesson, submit an attempt, close the application, and resume on another client.

Work:

- Perform a bounded mobile and signed-Electron identity/deep-link spike.
- Add verified backend identity and internal user mapping.
- Add Alembic migrations for the minimal persistence model.
- Add sessions, attempts, and resume endpoints.
- Generate the TypeScript API client from OpenAPI.
- Add idempotent attempt writes.

Acceptance:

- User identity is derived server-side.
- Cross-user session access is denied.
- Retried attempts do not duplicate learning evidence.
- Resume works across two clients.

## Slice 4: Versioned curriculum engine

Outcome:

- Reviewed authored content can be validated and published as an immutable course version.

Work:

- Add content schemas and validation.
- Add skills, prerequisites, lessons, and activities required by the golden mission.
- Publish immutable course versions.
- Link every attempt to its course/activity version.
- Define mappings for curriculum evolution.

Acceptance:

- Invalid references or prerequisites block publication with precise errors.
- A new version cannot silently change historical attempts.

## Slice 5: Mastery and review

Status: partially implemented in deterministic local evidence/review policy; server-owned durable
state and cross-client read models are not.

Outcome:

- Learning evidence updates deterministic skill state and schedules useful review.

Work:

- Add mastery rules and tests.
- Update attempt, skill evidence, and review scheduling in one transaction.
- Add due-review API and Review UI.
- Add Progress read models based on evidence.

Acceptance:

- Stored attempts reproduce mastery decisions.
- Review ordering is deterministic and bounded.
- Progress does not rely on client-computed durable totals.

## Slice 6: OpenAI Realtime conversation

Outcome:

- A learner can complete one course-connected Greek conversation through the direct OpenAI Realtime
  voice-only path on supported mobile and desktop clients. The learner may select LiveAvatar Show
  tutor presentation without changing the conversation or learning contract.

Work:

- Freeze one server-resolved `VoiceSessionSpec` for voice-only and Show tutor.
- Model session lifecycle separately from turn state, presentation state, and normalized events.
- Add authenticated admission, end, and recap endpoints under the existing `/v1`
  convention.
- Implement and verify direct OpenAI Realtime voice-only before optional avatar integration.
- Add captions, interruption, reconnect, idempotent finalization, usage limits, cleanup, and cost
  attribution.
- Add LiveAvatar only as the user-selectable Show tutor adapter with clean voice-only fallback.
- Evaluate communicative meaning separately from pronunciation; add media storage or workers only
  when a validated acoustic assessment actually requires durable asynchronous work.
- Keep OpenAI and LiveAvatar unable to own or mutate curriculum, scoring, XP, evidence, entitlement,
  or unlock state.

Acceptance:

- Direct voice-only completes the authored scenario on physical iPhone, Android, and Electron.
- Show tutor on/off uses the same `VoiceSessionSpec` and produces the same authoritative outcomes.
- Avatar unavailability or failure never ends otherwise healthy voice.
- Reconnect, cancellation, provider replay, and finalization do not duplicate turns, evidence, XP, or
  usage accounting.
- Every provider resource stops on completion, cancellation, timeout, disconnect expiry, or error.
- Feedback claims only capabilities validated for Greek, and no transcript is presented as a
  pronunciation score.

## Slice 7: Offline current unit

Outcome:

- A learner can complete deterministic exercises in the current downloaded unit and synchronize later.

Work:

- Cache versioned unit content and audio.
- Queue attempts in local SQLite.
- Reuse server idempotency identifiers during synchronization.
- Define conflict and expiration behavior.

Acceptance:

- Network loss does not lose a completed local attempt.
- Reconnection does not duplicate evidence.
- Unsupported online-only activities explain their requirement clearly.

## Slice 8: Monetization and release readiness

Status: partially implemented; desktop release, Clerk, and server-owned RevenueCat foundations exist,
but RevenueCat remains disabled and the full product release/enablement gates have not passed.

Outcome:

- The validated learning product can be tested and released through supported mobile and desktop channels.

Work:

- Implement store-compliant entitlements and restore flows.
- Add account deletion and data export.
- Configure EAS preview/production builds.
- Configure signed/notarized macOS distribution.
- Add production API/database/worker deployment pipelines.
- Complete accessibility, privacy, store metadata, and recovery checks.

Acceptance:

- Store builds install and exercise the critical learning flow.
- Entitlements reconcile across supported platforms.
- Signed/notarized desktop packages pass clean-install Gatekeeper checks.
- Production deployment has backups, readiness, monitoring, and rollback strategy.

## What not to parallelize prematurely

- Do not build the entire database schema before the golden mission establishes real data needs.
- Do not add workers before a durable long-running operation exists.
- Do not start optional avatar integration before the direct OpenAI Realtime voice-only acceptance
  path and shared `VoiceSessionSpec` are proven.
- Do not implement offline sync before the online idempotency contract works.
- Do not integrate billing before the learning loop is validated.
- Do not extract microservices while one transaction protects core learning invariants.
- Do not build a content studio before the file-based authoring and review workflow is understood.

## Review gate between slices

Before beginning the next slice:

1. Confirm the previous observable outcome works.
2. Inspect the actual repository and data shape.
3. Record any architectural decision that changed.
4. Remove no compatibility path still used by released clients.
5. Choose the next smallest slice based on product evidence, not this roadmap alone.
