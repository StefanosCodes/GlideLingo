# Feature Development Pattern

## Purpose

This is the repeatable process for adding GlideLingo behavior without losing the end-to-end flow.

The goal is not to fill every architectural layer. The goal is to deliver one observable capability using only the layers it needs.

## Start with the outcome

Describe the behavior as something a learner or operator can observe.

Good:

> A learner can submit an answer, close the application, reopen it, and see the saved lesson position.

Too implementation-focused:

> Add a session service, repository, query hook, Redis cache, and event bus.

The first statement defines value. The second prematurely selects machinery.

## Map the vertical slice

Before editing, identify the required path:

```text
User action
→ route/screen
→ feature state
→ API operation
→ authenticated backend use case
→ transaction/data change
→ response
→ visible success or recovery state
```

For each layer, write down:

- The owner.
- The public contract.
- The source of truth.
- Failure behavior.
- The cheapest test that proves it.

## Example: submit a lesson attempt

### User experience

The learner selects an answer and submits it.

Required states:

- Ready to answer.
- Submitting.
- Correct or incorrect result.
- Recoverable network failure with retry.
- Already-submitted/idempotent replay.
- Session no longer valid.

### Frontend

```text
src/app/lesson/[sessionId].tsx
  → renders LearningSessionScreen

src/features/learning-session/
  → owns answer selection, progression, and result presentation
  → calls a typed attempt mutation
```

The route reads the session identifier and composes the feature. It does not score the answer or call `fetch` directly.

### API

Conceptual operation:

```text
POST /v1/learning-sessions/{session_id}/attempts
```

The request includes:

- Activity identifier.
- Submitted response.
- Stable client-generated attempt identifier.

The request does not include a trusted user identifier. The backend derives the learner from verified authentication.

The response contains only the public result required by the client, such as correctness, feedback, next activity, and updated session progress.

### Backend

The router:

- Validates transport data.
- Loads verified identity.
- Invokes one cohesive submit-attempt operation.
- Maps known failures to stable HTTP errors.

The use case:

- Confirms the session belongs to the learner.
- Confirms the activity belongs to the session’s immutable course version.
- Evaluates deterministic rules.
- Applies the complete transaction.

### Database transaction

One transaction may:

1. Insert the append-only attempt.
2. Update the learning-session position.
3. Update learner skill evidence.
4. Schedule or update a review item.
5. Commit once.

A uniqueness constraint on learner/operation identity protects retries. External analytics or provider calls stay outside the transaction.

### Verification

- Domain test for scoring behavior.
- API contract test for valid and invalid requests.
- Authorization test for another learner’s session.
- PostgreSQL integration test for the transaction and uniqueness rule.
- Frontend test for loading, success, failure, and retry state.
- One real client flow proving submit and resume.

## Frontend design rules

### Routes stay thin

A route may:

- Read route parameters.
- Choose an application layout.
- Render one or more feature surfaces.

A route should not:

- Contain learning rules.
- Construct API URLs.
- Manage persistent remote data manually.
- Become the only place a feature can be tested.

### Features own behavior

A feature colocates the components, state transitions, API adapters, and tests that change together.

### Shared UI stays product-agnostic

Design primitives such as buttons, text, surfaces, symbols, switches, and progress bars accept presentation and accessibility inputs. They do not understand course versions, learner mastery, or review scheduling.

### State uses the narrowest owner

- Derive what can be derived.
- Use local component state for transient interaction.
- Use route state for navigation identity.
- Use the remote-data layer for server state.
- Use a reducer when transitions form a meaningful workflow.
- Use PostgreSQL for durable cross-device truth.

### Async UI is complete

Every remote path deliberately handles applicable loading, empty, success, error, cancellation, stale response, and retry behavior. Writes remain safe even if the UI disables double submission because network retries can occur outside the component.

## Backend design rules

### Contract before handler

Define request, response, status, error, authentication, authorization, idempotency, and compatibility before writing the handler.

### Controllers are transport adapters

FastAPI routers handle HTTP. They do not become business-logic containers.

### Services are earned

Create a service/application operation when there are real rules, multiple side effects, a transaction, or multiple callers. Do not create a pass-through service for architectural symmetry.

### Queries are feature-specific

Prefer named queries such as `load_owned_learning_session` over a generic repository API. Ownership scope belongs in the query where practical.

### Transactions protect complete invariants

Commit all database changes that must agree together. Do not split one invariant across several independent commits.

### Responses are explicit

Return public Pydantic response models. Never expose an ORM model by accident.

## Authentication and authorization

Planned identity flow:

```text
Client identity provider session
→ bearer token
→ FastAPI verifies token
→ server derives internal user
→ feature authorizes requested action/resource
```

Rules:

- Client-provided IDs are selectors, not authorization.
- Every resource lookup includes owner or tenant scope.
- `401` means valid authentication is absent.
- `403` means an authenticated user cannot perform the action.
- Tests include missing identity, invalid identity, and cross-user access.

## When to use a worker

Keep work in the request when it is bounded, needed for the response, and safe within the request deadline.

Use a durable worker only when work must survive failure, retry, schedule, or scale independently. A worker feature defines:

- Durable job ID and owner.
- Validated input reference.
- State transitions.
- Retryable versus terminal failures.
- Timeouts and concurrency.
- Idempotency and duplicate delivery.
- Cancellation and recovery.
- User-visible status.

## Definition of done for a feature

- Observable behavior matches the stated outcome.
- Routes, features, API contracts, backend behavior, and schema agree.
- Loading and failure states are deliberate.
- Authentication and resource authorization are tested where applicable.
- Retried writes cannot duplicate unsafe effects.
- Database constraints protect important invariants.
- Relevant mobile and desktop targets are exercised.
- Canonical verification commands pass.
- Documentation changes only where behavior or operation changed.
- The final diff contains no unrelated scaffolding or refactoring.
