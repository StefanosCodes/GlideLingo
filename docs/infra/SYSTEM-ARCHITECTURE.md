# System Architecture

## Product outcome

GlideLingo is intended to deliver one coherent language-learning product across Android, iOS, and desktop while preserving a learner’s curriculum, sessions, attempts, mastery evidence, and review state across devices.

The architecture should optimize for:

- A clear path from interface to durable state.
- High reuse across mobile and desktop.
- Deterministic learning rules.
- Easy local startup and failure diagnosis.
- Independent deployment of client and server artifacts.
- Safe evolution without premature distributed-system complexity.

## System map

```text
                        ┌─────────────────────┐
                        │ Shared TypeScript UI │
                        │ routes + features    │
                        └──────────┬──────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  │                │                │
             Expo Android      Expo iOS        Expo web
                                                   │
                                          ┌────────┴────────┐
                                          │                 │
                                      Web browser       Electron
                                                            │
                  └────────────────┬─────────────────────────┘
                                   │ HTTPS + typed contracts
                            ┌──────▼──────┐
                            │   FastAPI   │
                            │ modular app │
                            └──────┬──────┘
                                   │ transactions
                            ┌──────▼──────┐
                            │ PostgreSQL  │
                            └─────────────┘

Later, only when required:

FastAPI → durable job → worker → speech/model/storage provider
```

## Architectural boundaries

### Expo application

Expo owns the product interface for Android, iOS, and web. Feature behavior and domain logic are shared by default.

Platform-specific files such as `.ios.tsx`, `.android.tsx`, and `.web.tsx` are reserved for genuine differences including:

- Native controls or unavailable web APIs.
- Permissions and device capabilities.
- Audio recording and playback differences.
- Purchase flows.
- Navigation or layout that materially improves desktop interaction.

Electron resolves the web implementation. Native-only dependencies must never be imported into a module resolved by the web bundle without a web-safe boundary.

### Electron

Electron is a thin desktop host, not a second frontend application.

It owns:

- Window lifecycle.
- Secure loading of the Expo web output.
- Desktop packaging and signing.
- Narrow, validated IPC for future desktop-native capabilities.
- External navigation policy and desktop protocol handling.

It does not own learning rules, API state, curriculum behavior, or duplicated screens.

Security invariants remain:

- `nodeIntegration` disabled.
- Context isolation enabled.
- Chromium sandbox enabled.
- Permissions denied unless a feature explicitly requires one.
- External navigation restricted.
- IPC introduced only with validated request and response contracts.

### FastAPI modular monolith

The backend begins as one application and one deployable API. Product behavior is organized into cohesive modules, not separate network services.

Expected modules eventually include:

```text
users
curriculum
learning
review
speech
conversations
artifacts
billing
```

These names are a future map, not folders to create immediately.

Within a real module:

- The router adapts HTTP input and output.
- Schemas define public contracts.
- Domain or service functions own meaningful rules and orchestration.
- Feature-specific queries own persistence access.
- Models represent durable data owned by the module.

Do not create pass-through services, generic repositories, or one file of every type by ritual.

### PostgreSQL

PostgreSQL is the authoritative store for durable cross-device product state.

It eventually owns facts such as:

- User and learner profile records.
- Published course versions.
- Learning sessions and attempts.
- Learner skill states.
- Review items.
- Speech and conversation records.
- Entitlement references.

Core invariants should be enforced using database constraints and transactions, not only frontend checks.

### Workers

Workers are added only when work:

- Must survive process restarts.
- Exceeds a safe HTTP request duration.
- Needs controlled retries or scheduling.
- Has independent concurrency or provider limits.
- Must scale separately from API traffic.

Likely future uses include speech transcription, workbook generation, media processing, and selected AI operations. Ordinary lesson submissions and mastery updates remain synchronous.

## Canonical request flow

Every normal feature should be traceable through one direction:

```text
Expo route
  → frontend feature
  → feature query/mutation
  → shared generated API client
  → FastAPI router
  → application/domain operation
  → feature-specific database query
  → PostgreSQL transaction
  → typed response
  → visible UI state
```

Dependency direction should not reverse. Shared UI must not import product features. Domain rules must not import FastAPI requests. Database models must not be returned directly as public API schemas.

## State ownership

Choose the narrowest authoritative owner:

| State | Owner |
| --- | --- |
| Cheap calculated value | Derived during rendering or domain evaluation |
| Temporary interaction | Local component state |
| Navigation or shareable selection | URL/route state |
| Fetched server records | Remote-data/query layer |
| Theme, identity presentation, locale | Focused application provider |
| Lesson progression | Explicit feature reducer/state machine |
| Authentication session | Identity provider plus secure platform storage |
| Durable learning evidence | FastAPI and PostgreSQL |
| Offline pending attempts | Local SQLite queue, when implemented |
| Background processing | Durable job record and worker |

Avoid two writable sources of truth. If duplication is necessary for offline behavior, define synchronization, conflict handling, and recovery explicitly.

## API contract

FastAPI’s OpenAPI document becomes the source for generated TypeScript contracts once product endpoints exist.

API rules:

- Use deliberate operation identifiers.
- Use explicit request and response schemas.
- Return stable machine-readable errors.
- Evolve contracts additively because installed mobile clients may remain old.
- Bound collections and define deterministic ordering.
- Require idempotency for retryable side-effecting writes.
- Derive user identity from a verified server-side token.
- Authorize each action and resource; possession of an ID is not authorization.
- Configure explicit browser origins rather than wildcard credentialed CORS.

Planned error shape:

```json
{
  "error": {
    "code": "learning_session_not_found",
    "message": "The learning session could not be found.",
    "request_id": "req_...",
    "details": {}
  }
}
```

## Data and transaction rules

- Published course content is immutable and identified by `course_version`.
- Every learning attempt references the course and activity version it evaluated.
- Attempts are append-only evidence rather than mutable totals.
- Retried client writes carry a stable client-generated operation identifier.
- Attempt insertion, mastery changes, and review scheduling share one transaction when they form one invariant.
- External provider calls remain outside open database transactions.
- Schema changes use reviewed Alembic migrations.
- Indexes are created for observed queries and uniqueness rules, not hypothetical access patterns.

## Curriculum and AI boundary

The curriculum spine is authored, reviewed, validated, and versioned. AI may help generate practice variants, explanations, conversations, and authoring candidates, but deterministic code retains control over:

- Course ordering.
- Prerequisite enforcement.
- Mastery calculation.
- Review scheduling.
- Billing and authorization.
- Official progress claims.

For Modern Greek speech, recognition and pronunciation evaluation remain separate capabilities. Do not display phoneme-level accuracy unless a provider has been validated for that language and use case.

## Scaling model

Scale the modular monolith operationally before splitting services:

1. Add API replicas.
2. Tune measured queries and database capacity.
3. Move slow durable work to workers.
4. Scale worker types independently.
5. Add object storage/CDN for media.
6. Add caching only for measured hot paths with an invalidation policy.

Extract a microservice only when a module has proven independent ownership, scaling, isolation, runtime, or release requirements. Speech/media processing is a plausible future candidate. Core learning, mastery, and review should remain together while their transactional coupling is valuable.

## Explicit non-goals for the initial system

- Microservices.
- Kubernetes.
- Database-per-module.
- Redis without a concrete need.
- A global frontend state container.
- A generic repository framework.
- A content-management studio.
- Full offline behavior before online persistence works.
- Real-time full-duplex voice.
- A Tauri migration without measured justification.
