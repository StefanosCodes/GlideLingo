# Human Tutor Marketplace MVP Execution Plan

**Status:** Active implementation contract; local milestones remain feature-flagged and approval-gated

**Last repository audit:** 2026-09-04 against `origin/main` at
`c454ef4d616de809e00c9a9624636e714a6379f8`

**Primary audience:** Product, engineering, operations, QA, and coding agents

**Product boundary:** Human tutors; this is separate from the AI lesson tutor and OpenAI Realtime
voice coach

## Goal

Ship the smallest trustworthy human-tutor marketplace in which:

1. an adult tutor can apply, be approved, publish a profile, set an offering, connect availability,
   receive messages, accept a paid booking, provide an external meeting link, complete the lesson,
   and receive a payout;
2. an adult learner can find an approved tutor, message them, see accurate availability, pay for and
   manage a booking, join the external lesson, dispute a problem, receive follow-up, and submit a
   verified review; and
3. an authorized operator can approve supply, inspect marketplace state, handle safety reports,
   resolve booking and payment failures, issue refunds, and hold or release payouts.

The feature is language-agnostic. Tutors may teach multiple languages and dialects, learners may
have any interface language, and the marketplace must work when no compatible GlideLingo course
exists.

## Definition of done

The MVP is complete only when a production-shaped sandbox proves this exact journey end to end:

```text
Tutor applies
  -> operator approves
  -> tutor completes Stripe onboarding
  -> tutor publishes one offering and availability
  -> learner discovers and messages tutor
  -> learner selects an actually available slot
  -> GlideLingo holds the slot and collects payment exactly once
  -> booking becomes confirmed from verified provider evidence
  -> learner and tutor receive reminders and a protected external meeting link
  -> lesson ends and enters a bounded dispute window
  -> GlideLingo retains the snapshotted commission
  -> tutor transfer becomes eligible and is issued exactly once
  -> learner leaves one completed-booking review
  -> operator can recover every defined failure without direct database edits
```

Passing unit tests alone, rendering empty screens, using mock money, or manually repairing database
state does not satisfy this definition.

## How to use this plan

- This document is the decision ledger and execution checklist for the MVP.
- Start implementation in a new clean worktree from a freshly fetched `origin/main`.
- Reconstruct the live PR and migration queue before choosing a branch base or migration number.
- Implement milestones in order. A milestone may use several commits, but it must produce one
  coherent, independently verified capability.
- Continue to the next local milestone automatically when all exit gates pass.
- Stop at a listed stop condition. Do not guess through money, identity, privacy, authorization,
  migration, or external-account ambiguity.
- Do not push, open or retarget PRs, merge, apply shared migrations, mutate vendor settings, deploy,
  enable flags, or use live money without explicit authorization for that exact action.

## Current repository state

Confirmed at the audit commit:

- Expo SDK 57, React Native, Expo Router, and TypeScript serve Android, iOS, web, and Electron.
- FastAPI is the public authenticated API and follows a modular-monolith structure.
- PostgreSQL is the durable server-owned store.
- Clerk supplies authenticated principals; backend authorization derives identity from verified
  server context rather than submitted user IDs.
- RevenueCat owns the separate GlideLingo `pro` subscription and must not process human-tutor
  marketplace payments.
- The backend already demonstrates signed webhook validation, event deduplication, idempotency,
  least-privilege runtime roles, and operator-run SQL migration patterns.
- No human-tutor marketplace, Stripe Connect integration, calendar OAuth integration, marketplace
  messaging, booking engine, or tutor-payout ledger exists on the audited branch.
- The repository has no general-purpose worker that should be adopted blindly. Add durable work only
  for marketplace effects that must survive request or process failure.

Authoritative repository references:

- [`PRODUCT.md`](../../PRODUCT.md)
- [`docs/infra/README.md`](../infra/README.md)
- [`docs/infra/FEATURE-DEVELOPMENT.md`](../infra/FEATURE-DEVELOPMENT.md)
- [`docs/infra/SYSTEM-ARCHITECTURE.md`](../infra/SYSTEM-ARCHITECTURE.md)
- [`docs/infra/DEPLOYMENT.md`](../infra/DEPLOYMENT.md)
- [`docs/BILLING-MVP.md`](../BILLING-MVP.md)
- [`backend/migrations/README.md`](../../backend/migrations/README.md)

## Settled MVP product decisions

| Area | MVP decision |
| --- | --- |
| Participants | Adults only. Minor and guardian flows are excluded. |
| Tutor eligibility | Verified Clerk account, completed payout onboarding, submitted application, and manual operator approval. |
| Credentials | Optional for general tutors. A credential may be displayed as verified only after operator verification. |
| Languages | Universal many-to-many tutor/language/dialect model; no Greek-only fields or branches. |
| Offerings | Tutor-defined 25- or 50-minute one-to-one lessons with supported price bounds. |
| Introduction | Paid 25-minute introductory lesson; the tutor is paid under the normal commission rule. |
| Price | Tutor selects the displayed price. Learner sees one final price with no surprise service fee. |
| Commission | Versioned 20% default marketplace commission, snapshotted onto the booking at purchase. |
| Payment | Full amount collected at booking through Stripe Connect in the configured sandbox or live environment. |
| Transfer | Tutor transfer becomes eligible after completion and a 24-hour dispute window; eligible transfers enter a weekly payout cycle. |
| Cancellation | Free cancellation or rescheduling until 12 hours before start. A late learner cancellation or no-show is charged. |
| Tutor failure | Tutor cancellation or no-show returns a full learner refund and no marketplace commission; repeated failures affect visibility and approval. |
| Messaging | Text-only in-app messaging. No file attachments in the MVP. |
| Pre-booking contact | Allowed with rate limits and reporting. Off-platform contact details and meeting links are not allowed before a paid booking. |
| Calendar | Manual weekly teaching hours plus one optional Google Calendar free/busy connection. |
| Meeting | Tutor supplies an approved HTTPS Zoom, Google Meet, or Microsoft Teams URL. GlideLingo does not host media. |
| Recording | No recording, transcript, or replay. |
| Reviews | One review per completed booking, authored by that booking's learner and subject to moderation. |
| Learning context | Shared only for a confirmed booking after explicit learner consent; absence of course context never blocks tutoring. |
| Organizations | Deferred as a user-facing capability. Do not build organization administration in the MVP. |
| Search | Deterministic filters and ordering; no model-owned matching or ranking. |
| Currency | One configured presentment/settlement currency for the first launch environment. |
| Rollout | Both server and client marketplace flags default off; initial access uses explicit actor allowlists. |

These are code and sandbox defaults. Merchant-of-record, contractor classification, tax, privacy
retention, marketplace terms, and supported-country decisions require qualified legal/accounting
approval before live-money activation.

## MVP scope

### Included

- tutor application, operator review, approval, rejection, suspension, and reinstatement;
- tutor public profile, languages, dialects, specialties, optional verified credentials, and one or
  more simple offerings;
- manual recurring availability, exceptions, timezone handling, booking lead time, and buffers;
- one Google Calendar free/busy connection with minimal scopes and revocation recovery;
- learner discovery, bounded filtering, tutor profile view, and favorites;
- one learner-tutor text conversation with reporting and blocking;
- temporary slot holds, payment, confirmation, rescheduling, cancellation, completion, no-show,
  dispute, refund, transfer eligibility, and transfer execution;
- protected external meeting URL and calendar-file handoff;
- email reminders required for the MVP; push may be added only by reusing a working repository path;
- verified reviews after completed bookings;
- learner-consented pre-lesson context and tutor-authored post-lesson notes/recommendations;
- operator recovery surfaces and auditable state changes;
- sandbox-to-production configuration, migration, rollout, monitoring, and rollback contracts.

### Explicit exclusions

- built-in audio, video, WebRTC, recording, transcription, or replay;
- group classes, webinars, courses sold by tutors, or community content publication;
- minors, guardian consent, schools serving minors, or safeguarding flows for children;
- lesson subscriptions, packages, credits, gift cards, or expiring balances;
- AI matching, generated tutor rankings, automated moderation, or automated dispute judgments;
- multiple calendar providers or two-way general calendar synchronization;
- file attachments, voice notes, image sharing, or arbitrary rich content in chat;
- public self-approval, automated credential decisions, or background-check claims;
- tutor bidding, promoted placement, advertising, social feeds, or public leaderboards;
- multi-currency settlement, tax optimization, or unsupported Stripe countries;
- tutoring-company dashboards, roster administration, split organization payouts, or white-labeling;
- Redis, Kafka, Kubernetes, a new microservice, a generic event bus, or a generic repository framework;
- changes to RevenueCat `pro` products, entitlements, checkout, or affiliate commission semantics.

## Architecture principles

1. **One modular monolith.** Add cohesive marketplace modules to the existing FastAPI application
   and tables to the existing PostgreSQL database. Do not create a marketplace service.
2. **One owner per fact.** PostgreSQL owns durable booking, conversation, policy, money, and audit
   state. Stripe owns provider payment facts. Google owns external calendar availability. Clients
   render and request changes; they do not decide authorization or money state.
3. **Contracts before adapters.** Booking and payment rules must be testable without Stripe, Google,
   email, or a meeting provider. Provider adapters translate external behavior into typed domain
   results.
4. **Database-enforced invariants.** Prevent overlapping active bookings, duplicate reviews,
   duplicate webhook effects, conflicting idempotency keys, and repeated transfers with database
   constraints and transactions.
5. **External calls outside transactions.** Persist intent, commit, perform the external call with a
   stable operation key, then persist the observed result.
6. **Durability only where earned.** Use durable jobs/outbox records for reminders, calendar refresh,
   webhook-derived follow-up, refund/transfer execution, and other effects that must survive restart.
   Keep bounded reads and ordinary writes in the request path.
7. **Fail closed.** Missing configuration, unverifiable identity, stale payment evidence, incomplete
   payout onboarding, or ambiguous ownership cannot grant access, confirm money, or release a
   transfer.
8. **Additive compatibility.** APIs and migrations must tolerate older installed clients. Use
   additive schema evolution and explicit state/version fields.
9. **Configuration is not a framework.** Only real policy knobs are configurable. Do not build a
   general rules engine.

## Component boundaries

```text
Expo/Electron routes
  -> tutor-marketplace frontend features
  -> authenticated typed API boundary
  -> FastAPI marketplace modules
       -> tutor network
       -> discovery
       -> availability/calendar
       -> messaging
       -> bookings
       -> marketplace commerce
       -> learning handoff
       -> operations/moderation
  -> PostgreSQL transactions and durable jobs
  -> external adapters: Stripe, Google Calendar, email, external meeting URL
```

### Frontend ownership

Routes compose feature surfaces and remain thin. Candidate route ownership:

- learner: `/tutors`, `/tutors/[tutorId]`, `/bookings`, `/bookings/[bookingId]`, and
  `/messages/[conversationId]`;
- tutor: `/tutor/apply`, `/tutor/profile`, `/tutor/availability`, `/tutor/bookings`, and
  `/tutor/earnings`;
- operator: a minimal protected marketplace-operations surface, not a general admin platform.

Use a cohesive `src/features/tutor-marketplace/` boundary with public feature entry points. Keep
search/filter identity in URL state, fetched marketplace records in the established remote-data
boundary, booking workflows in explicit reducers/state machines where useful, and durable state on
the backend. Shared design components remain marketplace-agnostic.

### Backend ownership

Start with a `backend/app/modules/tutor_marketplace/` feature boundary. Split internal files only when
a stable responsibility requires it; do not create an empty router/service/repository file for every
noun.

The marketplace owns:

- tutor eligibility and application state;
- public profile and offering publication rules;
- availability calculation and calendar-connection metadata;
- conversation membership and message authorization;
- booking, cancellation, completion, dispute, and review rules;
- policy snapshots and the internal transaction/transfer ledger;
- normalized Stripe and calendar adapter contracts;
- operator decisions and audit records.

The existing billing module continues to own RevenueCat entitlement state. Affiliate identity and
finance remain separate domains even if they later consume the same low-level payment provider.

### Durable work ownership

Marketplace jobs must have a stable ID, job type, resource owner, validated resource reference,
state, attempt count, next-attempt time, lease, bounded error classification, and terminal recovery
action. Initial job types may include only:

- expire unpaid slot hold;
- refresh calendar free/busy cache;
- send booking reminder;
- issue approved refund;
- create or reverse tutor transfer;
- terminalize stale provider operations.

Workers assume at-least-once delivery. Each effect uses a stable provider idempotency key and a local
uniqueness rule. Do not add a queue product until database-backed claims are proven insufficient.

## Authority and privacy matrix

| Resource/action | Learner | Tutor | Operator | Provider |
| --- | --- | --- | --- | --- |
| Public tutor profile | Read published | Edit own draft | Approve/suspend | None |
| Private application | Own read/write before submit | Own | Review | Stripe verifies payout identity separately |
| Calendar details | No access | Connect/revoke own | Status only | Google owns original data |
| Busy intervals | See derived open slots only | See derived status | Diagnostic metadata only | Google source of truth |
| Conversation | Participant only | Participant only | Report-scoped access | None |
| Booking | Own booking | Assigned booking | Support access | Stripe owns payment evidence |
| Meeting URL | Confirmed learner only | Assigned tutor | Authorized support | External provider hosts meeting |
| Learning brief | Explicitly consent and view | Confirmed tutor during bounded access window | No routine access | None |
| Refund/dispute | Request on own booking | Respond on assigned booking | Decide within policy | Stripe executes financial effect |
| Review | One per completed owned booking | Read published | Moderate | None |
| Transfer | No access | Read own summary | Hold/release under policy | Stripe executes payout/transfer |

Never accept a submitted learner ID, tutor ID, organization ID, commission, payout amount, approval
state, or completion assertion as authority. Resolve the actor from Clerk and load the scoped
resource before every action.

## Core state machines

### Tutor application

```text
draft -> submitted -> under_review -> approved
                              \----> rejected
approved -> suspended -> approved
```

- Only approved, unsuspended tutors with complete payout onboarding may publish offerings.
- Suspending a tutor removes public discovery immediately and requires an operator decision for
  future confirmed bookings; it must not silently cancel or refund them.

### Booking

```text
slot_held -> payment_pending -> confirmed -> completed -> dispute_window -> settled
    |               |              |            |                |
    v               v              v            v                v
 expired       payment_failed   cancelled    disputed        refunded
                                   |
                         learner_no_show / tutor_no_show
```

- Every transition is explicit, authorized, timestamped, and audited.
- An expired or failed-payment hold releases availability.
- A paid booking cannot disappear. Cancellation creates a terminal financial outcome.
- Rescheduling preserves history and produces a new immutable schedule revision; it is not an
  in-place timestamp rewrite without an audit trail.

### Payment and transfer

```text
created -> processing -> succeeded -> transfer_pending -> transferred
    |          |              |              |                |
    v          v              v              v                v
 failed   ambiguous       refund_pending  transfer_failed  reversed
                              |
                           refunded
```

- The client redirect is presentation evidence only. Verified Stripe API/webhook evidence owns the
  payment result.
- The booking stores immutable gross amount, currency, commission policy/version, commission amount,
  tutor share, cancellation policy/version, and provider references.
- A unique transfer business key prevents duplicate tutor payment.

### Calendar connection

```text
disconnected -> authorizing -> active -> refresh_required
                                  |             |
                                  v             v
                               revoked       active
                                  |
                                  v
                             disconnected
```

- Manual availability remains usable when no external calendar is connected.
- Stale or unavailable free/busy data must be visible to the tutor and rechecked before a slot hold.
- Only free/busy intervals are cached; event titles, descriptions, attendees, and locations are not
  retained.

## Minimum durable data model

Exact names follow repository conventions during implementation. The first migration should add only
tables required by the milestone being implemented, not this entire future list at once.

| Fact | Required invariant |
| --- | --- |
| Tutor application | One active application lifecycle per Clerk-derived actor; immutable review audit. |
| Tutor profile | One profile per approved actor; unpublished by default; safe public projection. |
| Tutor language/specialty | Normalized many-to-many records; no language-specific columns. |
| Tutor offering | Positive amount, supported currency/duration, active tutor ownership, versioned changes. |
| Availability rule/exception | IANA timezone plus local recurrence; explicit effective dates and buffers. |
| Calendar connection | One active Google connection per tutor for MVP; encrypted token material; no event content. |
| Busy interval cache | Bounded time range and retention; time intervals only; refresh/version metadata. |
| Conversation/participant | Only authorized learner/tutor pair; block/report state; bounded messages. |
| Message | Immutable author/resource ownership, sanitized bounded text, server timestamp. |
| Booking | Learner, tutor, offering revision, UTC interval, timezone presentation, policy and price snapshots. |
| Booking transition | Append-only transition audit with actor, reason, source, and timestamp. |
| Provider operation | Stable idempotency key, request fingerprint, state, provider reference, terminal result. |
| Stripe event ledger | Unique event ID, verified environment/account, provider occurrence time, bounded retention. |
| Refund/transfer ledger | Append-only amounts and provider evidence; unique business-operation key. |
| Learning-context consent | Booking-scoped, revocable consent with bounded visibility window. |
| Tutor follow-up | Tutor-authored private note/recommendation scoped to the booking and learner. |
| Review | Unique booking; only after eligible terminal booking state; moderation state separate from content. |
| Marketplace audit | Append-only privileged action record without secret or full sensitive payload storage. |
| Marketplace job | Atomic claim/lease, bounded retry, terminal state, and authorized recovery. |

Prevent overlapping active tutor bookings at the database boundary. Prefer a PostgreSQL time-range
exclusion constraint for blocking booking states after verifying required extension support and
migration privileges. If that cannot be deployed safely, use explicit generated slot inventory with
atomic conditional claims. Do not rely on a read-then-insert check in application code.

## Calendar contract

MVP availability is:

```text
manual teaching window
  - manual exceptions
  - confirmed/pending GlideLingo booking ranges
  - fresh Google free/busy ranges
  - configured before/after buffers
  = candidate learner-visible slots
```

Rules:

- store durable instants in UTC and the relevant IANA timezone for presentation and recurrence;
- handle daylight-saving gaps and repeated local times explicitly in tests;
- request the narrowest Google free/busy scope;
- keep refresh tokens encrypted server-side and never return them to the client;
- recheck cached freshness and current internal overlap before creating a slot hold;
- show a safe unavailable/retry state when calendar evidence is stale or the provider is unavailable;
- provide an ICS/Add to Calendar result for confirmed bookings rather than requesting broad calendar
  write access in the first slice;
- treat external calendar concurrency as a recoverable conflict: notify the tutor and provide an
  audited reschedule/refund path rather than claiming impossible cross-provider atomicity.

## Messaging and meeting-link contract

- Text only, with server-enforced byte/character bounds and control-character normalization.
- A learner may open at most one active pre-booking conversation with a tutor.
- Conversation creation and message sending are rate-limited per actor and tutor target.
- Participants may block and report. A block prevents new user messages but preserves authorized
  support access and booking system messages.
- Booking, payment, cancellation, rescheduling, and completion changes generate trusted system
  messages; user text cannot cause these transitions.
- Pre-booking text rejects email addresses, phone numbers, and meeting URLs under a transparent
  marketplace rule. Do not pretend this filter is perfect; audit repeat abuse.
- Meeting URLs are accepted only from approved HTTPS hosts, normalized, and stored on the protected
  booking projection rather than the public profile or ordinary chat.
- Only the confirmed learner, assigned tutor, and explicitly authorized support role can read the
  meeting URL.
- No lesson audio, video, transcript, or meeting-provider credential passes through GlideLingo.

## Marketplace commerce contract

- Use Stripe Connect for human-lesson commerce. Do not route marketplace payments through RevenueCat.
- Prefer Stripe-hosted connected-account onboarding for the MVP.
- Use separate charges and transfers when the configured platform/account/country combination
  supports the required delayed-transfer flow. Charge at booking; create the tutor transfer only
  after the lesson and dispute gate.
- Treat the legal merchant-of-record and loss-liability configuration as an activation decision that
  must match the actual Stripe account configuration and marketplace terms.
- Verify webhook signatures over provider-required raw bytes, reject the wrong account/environment,
  deduplicate event IDs, and apply newer provider state without regressing from out-of-order events.
- Use both local business-operation uniqueness and Stripe idempotency keys for charge, refund,
  transfer, and reversal operations.
- Do not hold open database transactions across Stripe requests.
- Refund and transfer workers classify transient, permanent, and ambiguous outcomes. Ambiguous money
  state requires reconciliation before retry.
- The public API and logs expose no bank data, tax identifiers, full provider payloads, secrets, or
  unnecessary payment identifiers.
- Operator actions use explicit capabilities; ordinary support access cannot change commission or
  issue arbitrary transfers.

Official implementation references:

- [Stripe Connect marketplace](https://docs.stripe.com/connect/marketplace)
- [Stripe marketplace payment choices](https://docs.stripe.com/connect/marketplace/tasks/accept-payment)
- [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Google Calendar OAuth scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)

## API contract outline

Exact paths may be refined before the first handler, but operation ownership and behavior may not be
left implicit.

| Capability | Conceptual operation |
| --- | --- |
| Submit tutor application | `POST /v1/tutor-applications` with idempotency |
| Read/update own application | `GET/PATCH /v1/tutor-application` with optimistic concurrency |
| Review application | `POST /v1/marketplace-operations/tutor-applications/{id}/decision` |
| Read/update tutor profile | `GET/PATCH /v1/tutor-profile` |
| Publish/unpublish profile | Explicit idempotent action; never inferred from editing |
| Search tutors | `GET /v1/tutors` with cursor pagination, bounded filters, deterministic ordering |
| Read public tutor | `GET /v1/tutors/{id}` returning a safe public projection |
| Manage offerings | Owned `POST/PATCH` operations with version checks |
| Manage availability | Owned rules/exceptions plus a bounded slot-preview operation |
| Connect calendar | Server-created OAuth start/callback with signed state and exact redirect allowlist |
| List slots | Bounded tutor/date range with freshness status |
| Start conversation/send message | Participant-scoped, rate-limited, idempotent writes |
| Hold slot | Idempotent booking creation with database overlap protection and expiry |
| Start checkout | Owned booking only; exact server-calculated amount and Stripe environment |
| Receive Stripe webhook | Raw-body signature verification, deduplication, fast acknowledgement |
| Read/manage booking | Role-scoped projection and explicit transition operations |
| Submit completion/dispute | Actor-scoped idempotent actions with policy validation |
| Submit review | One idempotent review per eligible completed owned booking |
| Read tutor earnings | Tutor-scoped summarized ledger; no learner payment secrets |
| Operate refund/payout/report | Capability-scoped operator actions with mandatory reason and audit |

All collections are bounded and deterministically ordered. Every write defines validation, stable
errors, authentication, resource authorization, idempotency, concurrency, cancellation, timeout, and
retry behavior before implementation.

## Environment and credential matrix

| Environment | Database | Stripe | Google Calendar | Email | Marketplace flag | Evidence required |
| --- | --- | --- | --- | --- | --- | --- |
| Unit/CI | Isolated test schema/fakes | Signed fixtures/fake adapter; no network | Fake adapter; no OAuth | Capturing fake | Off unless test overrides | Deterministic state, contract, auth, duplicate, and failure tests |
| Local | Local PostgreSQL | Dedicated Stripe sandbox | Dedicated Google OAuth test application | Local capture or safe sandbox | Off by default; explicit actor allowlist | Real callback/redirect and local end-to-end smoke without live money |
| Development | Development Cloud SQL | Dedicated Stripe sandbox account/config | Development OAuth project/client | Development sender | Off by default; approved testers | Resolved project/account IDs, pinned secret references, migrations, webhooks, sandbox transaction |
| Production | Separate production database/config | Live Connect configuration | Verified production OAuth client | Production sender/domain | Off until activation approval | Exact account ownership, live-mode provenance, least privilege, monitoring, rollback, controlled pilot |

Server secrets belong in the environment's secret manager and are consumed only by the API/worker.
Do not expose Stripe secret keys, webhook secrets, Google client secrets, token-encryption keys, OAuth
refresh tokens, or email-provider credentials through `EXPO_PUBLIC_*` variables. Public client
configuration may contain only non-secret feature presentation values and approved public origins.

## Milestone execution plan

### Milestone 0 — Reconcile the live baseline and freeze the contract

**Outcome:** The implementation starts from current repository and vendor facts rather than this
document's audit snapshot.

**Work:**

- fetch `origin/main`, record its SHA, inspect the live PR/worktree/migration queue, and choose a clean
  worktree and `codex/` branch;
- confirm which auth, billing-event worker, API error, migration, feature-flag, and client-route
  patterns are now canonical;
- allocate file ownership and the next migration number without colliding with open work;
- confirm the settled MVP decisions above and record any authorized changes in this document;
- record actual sandbox and production account ownership/provenance without exposing secrets;
- confirm the initial transaction currency, Stripe-supported tutor countries, meeting-link allowlist,
  operator capability owners, and legal/privacy activation blockers.

**Verification:**

- `git status --short --branch`
- `git diff --check`
- documentation-link validation used by the repository, if present

**Exit gate:** One current base SHA, one writer per overlapping area, no unresolved migration or
domain ownership collision, and no product decision delegated to implementation.

**Stop when:** The intended base includes unintegrated overlapping marketplace/payment work, the next
migration number is disputed, external account ownership is unknown, or a settled decision changes
the public contract materially.

### Milestone 1 — Domain, policy, identity, and migration foundation

**Outcome:** Approved tutors and marketplace policy exist as server-owned facts while the marketplace
remains unreachable to ordinary users.

**Work:**

- add disabled-by-default server/client flags and actor allowlists;
- add the smallest reviewed SQL migration for tutor applications, profiles, languages, credentials,
  offerings, policy versions/snapshots, operator capability membership, and audit records;
- add application/profile/offer operations and safe public projections;
- derive every actor from verified Clerk context and enforce tutor/operator resource authorization;
- add manual operator approval/rejection/suspension and tutor draft/publish controls;
- add a minimal tutor application/profile UI and protected operator workflow.

**Acceptance:**

- an unapproved tutor cannot publish or appear in discovery;
- an approved tutor without complete payout readiness can prepare but not activate a paid offering;
- cross-user and privilege-escalation attempts fail without disclosing private resources;
- feature-off behavior registers no public marketplace route or paid action;
- policy changes are versioned and existing snapshots remain immutable;
- runtime database role cannot run DDL or unauthorized deletes.

**Verification:**

- focused domain, router, authorization, and migration tests;
- PostgreSQL privilege and constraint tests;
- `npm run api:verify`
- `npm run verify`
- `npm run verify:full-stack`

**Stop when:** Identity provenance, operator authority, public/private profile projection, migration
ownership, or policy versioning is ambiguous.

### Milestone 2 — Discovery and manual availability

**Outcome:** An allowlisted learner can find an approved tutor and see trustworthy manually declared
slots without payment or external calendar access.

**Work:**

- add recurring availability, exceptions, IANA timezone, lead time, and buffers;
- add bounded slot derivation and tutor-visible preview;
- add cursor-paginated tutor discovery and deterministic filters for language, dialect, specialty,
  price, duration, rating, availability, and verified credentials as applicable;
- add learner list/profile/favorite surfaces and tutor availability editing;
- cover loading, empty, unavailable, stale, error, retry, accessibility, keyboard, and text-scaling
  states.

**Acceptance:**

- no unapproved or suspended tutor leaks into discovery;
- the same facts produce deterministic slots and ordering;
- DST gaps/repeated times and timezone changes have explicit tested behavior;
- collections and date ranges are bounded;
- a learner cannot infer private calendar data or private profile fields.

**Verification:**

- domain tests for recurrence, buffers, DST, filters, and pagination;
- API authorization and contract tests;
- frontend loading/empty/error/accessibility tests;
- `npm run verify`
- `npm run api:verify`
- `npm run verify:full-stack`
- `npm run desktop:export`
- browser/Electron and one native-target discovery smoke journey

**Stop when:** Slot semantics differ across platforms, timezone ownership is unclear, or overlap
prevention would depend only on client state.

### Milestone 3 — Google free/busy calendar boundary

**Outcome:** A tutor can connect and revoke Google Calendar, and learner-visible slots exclude fresh
busy intervals without exposing calendar content.

**Work:**

- add signed OAuth state, exact redirect allowlists, minimal free/busy scope, encrypted refresh-token
  storage, token rotation/revocation handling, and connection status;
- normalize provider free/busy intervals through a narrow adapter;
- add bounded cache/refresh metadata and durable refresh work only where restart-safe retry is needed;
- recheck provider/cache freshness before a booking hold;
- retain manual availability as the fallback and provide ICS/Add to Calendar output later for
  confirmed bookings.

**Acceptance:**

- event names, descriptions, attendees, locations, and calendar IDs are not exposed or retained
  beyond the minimum provider reference required for the connection;
- invalid/replayed OAuth state, wrong actor, wrong redirect, revoked token, rate limit, timeout, and
  partial provider outage have explicit safe behavior;
- repeated refreshes are idempotent and bounded;
- stale calendar data never appears as silently current.

**Verification:**

- fake-adapter unit and contract tests;
- OAuth state/redirect/CSRF and encryption-boundary tests;
- PostgreSQL job claim/lease/duplicate/retry tests if durable refresh is added;
- `npm run api:verify`
- `npm run verify`
- `npm run verify:full-stack`
- real development OAuth connect, refresh, revoke, and reconnect evidence with no secret output

**Stop when:** The required OAuth scope exceeds free/busy needs, encryption-key provenance is unknown,
Google application ownership is unclear, or recovery requires manual database changes.

### Milestone 4 — Messaging and protected lesson coordination

**Outcome:** A learner and tutor can coordinate inside GlideLingo while booking and money state remain
outside user-authored messages.

**Work:**

- add conversation membership, messages, system messages, blocking, reporting, and report-scoped
  operator access;
- add rate limits, input bounds, safe rendering, URL/contact filtering for pre-booking chat, cursor
  pagination, and bounded retention operations;
- add approved-host meeting URL validation and a protected booking projection, initially inactive
  until bookings exist;
- add email notification jobs for new messages with deduplication and preference checks.

**Acceptance:**

- only participants can read or send; cross-conversation and guessed-ID access fails;
- blocked users cannot send new user messages;
- operator access is capability- and report-scoped and audited;
- malicious text renders as text, not executable content;
- a message cannot change booking, payment, completion, refund, or payout state;
- meeting URLs never appear on public profiles or pre-booking responses.

**Verification:**

- authorization, enumeration, rate-limit, pagination, injection/rendering, block/report, and retention
  tests;
- email duplicate/failure/retry tests if email delivery is durable;
- `npm run api:verify`
- `npm run verify`
- `npm run verify:full-stack`
- browser/Electron two-actor conversation smoke journey

**Stop when:** Support visibility is broader than a reported case, message retention is undefined for
the launch jurisdiction, or arbitrary content/attachments enter scope.

### Milestone 5 — Slot holds, Stripe onboarding, checkout, and confirmation

**Outcome:** A payout-ready tutor and allowlisted learner can create one real sandbox paid booking
without double charge or double booking.

**Work:**

- add Stripe Connect hosted onboarding status without persisting sensitive onboarding data;
- add database-enforced overlap protection, slot-hold expiry, booking/price/policy snapshots, and
  booking transition audit;
- add idempotent Checkout/PaymentIntent creation with server-calculated amount, currency, commission,
  and exact environment/account validation;
- add signed raw-body webhook verification, event deduplication, out-of-order handling, reconciliation,
  and fast acknowledgement;
- confirm the booking only from verified provider evidence;
- expose safe payment-pending, failed, cancelled, ambiguous, expired, confirmed, and retry UI states;
- copy the tutor's approved meeting URL into the protected confirmed-booking view and emit ICS data.

**Acceptance:**

- concurrent attempts cannot acquire overlapping active ranges for one tutor;
- client amount, commission, actor ID, tutor ID, currency, and success redirect cannot override server
  authority;
- retries return the same provider operation or a stable conflict for changed input;
- duplicate/out-of-order webhooks cannot duplicate or regress state;
- payment success plus client disconnect converges through webhook/reconciliation;
- payment failure or hold expiry releases the slot;
- account or environment mismatch fails closed;
- confirmed booking is visible only to its learner, tutor, and authorized operator.

**Verification:**

- domain/state-machine and money-rounding tests;
- PostgreSQL concurrent-overlap, hold-expiry, uniqueness, and transaction rollback tests;
- webhook signature, replay, duplicate, ordering, wrong-environment, wrong-account, oversized-body, and
  provider-timeout tests;
- frontend checkout cancellation/ambiguity/recovery tests;
- `npm run api:verify`
- `npm run verify`
- `npm run verify:full-stack`
- `npm run test:desktop`
- `npm run desktop:export`
- real Stripe sandbox evidence for success, cancellation, decline, duplicate webhook, and account
  switching

**Stop when:** Merchant/account configuration differs from the plan, amount ownership is ambiguous,
the migration cannot prevent overlap, payment state needs manual database repair, or live credentials
are the only way to continue.

### Milestone 6 — Booking management, completion, refunds, transfers, and reviews

**Outcome:** The complete marketplace money lifecycle converges after success, cancellation, no-show,
dispute, refund, transfer, reversal, timeout, or restart.

**Work:**

- add policy-driven reschedule/cancel/no-show/completion/dispute transitions and schedule revision
  history;
- add reminders, completion prompts, 24-hour dispute window, and operator decision workflow;
- add idempotent refund, transfer, and reversal operations through durable jobs;
- add tutor earnings projection and weekly eligible-payout behavior without exposing learner payment
  data;
- add one verified review per eligible completed booking with moderation state;
- add operator recovery for ambiguous money operations and stale job leases.

**Acceptance:**

- cancellations apply the booking's snapshotted policy, not the latest policy;
- tutor cancellation/no-show produces full learner refund and no commission;
- eligible learner late cancellation/no-show produces the configured tutor share;
- refund, transfer, and reversal can each be retried without duplicate money movement;
- ambiguous provider outcomes reconcile before retry;
- no transfer becomes eligible before completion/dispute gates;
- a disputed/refunded booking cannot publish an ineligible review;
- operator action requires a reason, least privilege, and immutable audit evidence.

**Verification:**

- exhaustive transition-table tests for actor, state, time boundary, and policy version;
- worker duplicate, crash-after-provider-effect, lease expiry, retry exhaustion, cancellation, and
  terminal-recovery tests;
- refund/transfer ledger conservation and rounding tests;
- PostgreSQL integration tests for transaction and privilege boundaries;
- `npm run api:verify`
- `npm run verify`
- `npm run verify:full-stack`
- real sandbox full refund, late cancellation, transfer, failed transfer/retry, and reversal evidence;
- browser/Electron learner, tutor, and operator completion journeys

**Stop when:** Money conservation cannot be proven, provider/legal payout timing conflicts with the
policy, support can bypass audit, or recovery requires arbitrary provider/dashboard edits without a
recorded reconciliation action.

### Milestone 7 — Learning-context and tutor follow-up bridge

**Outcome:** Human tutoring connects to GlideLingo learning without making the tutor marketplace or AI
providers authoritative over official learner progress.

**Work:**

- add booking-scoped explicit consent for a minimal pre-lesson learning brief;
- produce a safe read model containing learner-selected goal and only the course/capability/review
  context approved by the product learning contract;
- bound tutor access to the assigned confirmed booking and a documented time window;
- add tutor-authored private follow-up and recommendations that reference existing GlideLingo content
  when available and support free text when no course exists;
- keep mastery, XP, evidence, entitlement, and unlock state read-only to this module.

**Acceptance:**

- no consent means no learning brief;
- revocation removes future access without rewriting legitimate booking/audit history;
- another tutor, learner, operator without purpose, or guessed booking cannot access the brief;
- tutor notes cannot mutate official learning evidence;
- marketplace remains functional for languages without a GlideLingo course;
- sensitive context is absent from logs, notifications, and payment/calendar providers.

**Verification:**

- consent grant/revoke/expiry and cross-actor authorization tests;
- public/private projection and logging tests;
- learning-authority regression tests;
- `npm run verify`
- `npm run api:verify`
- `npm run verify:full-stack`
- browser/Electron consent, tutor brief, follow-up, and no-course journeys

**Stop when:** The learning contract cannot define the safe summary, tutor writes would become mastery
authority, or consent/retention behavior is unresolved.

### Milestone 8 — Integrated hardening and controlled pilot readiness

**Outcome:** The complete feature is observable, recoverable, disabled by default, and ready for an
explicitly approved production pilot.

**Work:**

- inspect the complete integrated diff and remove unused abstractions, scaffolding, flags, providers,
  indexes, and configuration;
- run migration compatibility and least-privilege checks against a production-shaped database;
- define dashboards/alerts for booking failures, overlapping-slot conflicts, webhook age/failure,
  calendar staleness, reminder lag, refund/transfer failure, dispute rate, and worker saturation;
- write operator runbooks for tutor suspension, calendar failure, stuck payment, duplicate/ambiguous
  provider event, refund, failed transfer, dispute, secret rotation, feature disable, and rollback;
- verify sandbox and production configuration provenance without reading secret payloads;
- complete policy, privacy, marketplace terms, tax, contractor, store, and support review;
- rehearse rollback with flags off and additive migrations left safely in place;
- run the controlled allowlisted end-to-end pilot acceptance matrix.

**Required repository verification:**

- `npm run verify`
- `npm run doctor` when Expo dependencies/configuration changed
- `npm run test:desktop`
- `npm run desktop:export`
- `npm run api:verify`
- `npm run verify:full-stack`
- `npm run verify:full`
- actual browser, Electron, iOS, and Android critical journeys for shipping targets

**Required external sandbox journeys:**

- tutor onboarding incomplete, completed, requirements changed, and disabled;
- calendar connect, fresh busy exclusion, provider timeout, revoked token, and reconnect;
- message, block, report, and unauthorized access;
- checkout success, cancellation, decline, timeout, duplicate and out-of-order webhook;
- simultaneous overlapping booking attempts;
- learner cancellation before and after cutoff;
- learner no-show, tutor cancellation/no-show, dispute, full refund, partial/late policy result;
- transfer success, retryable failure, ambiguous result, duplicate delivery, and reversal;
- learner/tutor account switch and sign-out throughout sensitive states;
- feature disabled while existing confirmed bookings remain operable through an explicit support path.

**Activation gate:** No general rollout until live account provenance, migration application, worker
deployment, recurring maintenance, least-privilege roles, monitoring, support ownership, legal/policy
approval, and a real allowlisted production transaction are evidenced. Repository completion is not
deployment or enablement completion.

**Stop when:** Any required gate is unknown, the integrated head differs from the verified head,
production resolves to sandbox/shared credentials unintentionally, a migration is destructive or
irreversible without a separate approved plan, or a critical journey needs manual database repair.

## Cross-milestone verification rules

Every milestone must record:

- base SHA and milestone head SHA;
- intended diff and every changed file;
- migration number/order and schema compatibility, when applicable;
- exact commands and pass/fail counts;
- runtime target actually exercised;
- external account/environment used, identified without secret material;
- unresolved risks and why they do or do not block the next milestone;
- explicit confirmation that no excluded scope was introduced.

Verification proceeds cheapest to most expensive:

1. pure domain and state-transition tests;
2. API schema/router/authorization tests;
3. PostgreSQL constraint, transaction, concurrency, migration, and privilege tests;
4. adapter/webhook/job failure tests;
5. frontend state and accessibility tests;
6. `npm run verify` and `npm run api:verify`;
7. `npm run verify:full-stack` for database work;
8. web/Electron/native runtime journeys;
9. sandbox provider journeys;
10. production-shaped rehearsal and allowlisted pilot.

Do not waive a lower gate because a higher-level happy-path smoke passed.

## Agentic execution protocol

An implementing agent should use this loop for each milestone:

```text
inspect current evidence
  -> state the milestone's observable acceptance
  -> choose the smallest repository-consistent change
  -> implement one coherent vertical slice
  -> run focused verification
  -> inspect failures and adapt from evidence
  -> run milestone gates
  -> inspect the complete diff
  -> record the checkpoint
  -> continue only if every exit gate passes
```

Agent rules:

- Resolve repository facts through inspection instead of asking the user.
- Ask only when a decision changes money, legal responsibility, privacy, public behavior,
  authorization, irreversible migration, or live external state.
- Preserve unrelated changes and use one writer for overlapping code areas.
- Prefer existing patterns before adding dependencies or abstractions.
- Do not create future milestone tables, routes, providers, or interfaces early.
- Do not claim provider behavior from mocks; record deterministic and live-sandbox evidence
  separately.
- Do not continue through a failing gate, ambiguous money state, schema collision, unsafe scope, or
  unverified credential provenance.
- A successful local run is permission to continue local work, not permission to mutate GitHub,
  vendor dashboards, shared databases, deployments, or feature flags.

## Checkpoint ledger

Update this table only with immutable evidence. Do not mark a milestone complete from an agent summary
without the referenced diff and test results.

| Milestone | Status | Base SHA | Head SHA | Verification evidence | Remaining gate |
| --- | --- | --- | --- | --- | --- |
| 0. Baseline and contract | Complete | `c454ef4d616de809e00c9a9624636e714a6379f8` | `621ee2567d9fb4a5f3ed5a43cefbbd013be18b64` | Live PR/worktree/migration queue revalidated on 2026-09-04; dedicated `codex/human-tutor-marketplace-mvp` continuation branch created at `ab72c8587850bb089edca4933fc9db5b6ccb734a`; migrations 004/005 remain owned by open affiliate/billing PRs, 006 by this feature, and 007 by the integration queue, so Marketplace addenda start at 008; Tutor-owned transaction/default-off corrections from integration evidence `77f3b591b730e086b56c3c445eff206f45650941` were ported without unrelated features; Expo SDK 57 patch alignment restored Doctor 21/21; `npm run verify:full-stack` passed with 99 client tests, 128 API unit tests, 25 PostgreSQL integration tests, 73 desktop tests, 15 private-tutor tests, and a successful web export | Production Stripe/Google ownership, launch countries, named operators, legal/privacy decisions, shared predecessor migrations, migration application, deployment, and activation remain external/integration gates; they do not block deterministic local implementation |
| 1. Domain/policy/identity | Complete | `c454ef4d616de809e00c9a9624636e714a6379f8` | `d07ef6e42c2e98aa01adcb105868a628adea2113` | `npm run verify:full-stack` passed at the immutable feature commit; 32 marketplace client tests within 99 passing client tests; 10 marketplace unit tests within 128 passing API tests; 12 marketplace PostgreSQL tests within 25 passing integration tests; Expo Doctor 21/21; desktop export emitted both protected tutor routes; negative ownership, capability, self-review, stale-version, policy-immutability, USD-only, payout-readiness, direct privileged-state insertion, pinned function search-path, first-write and suspension/publication concurrency, paging, audit, DDL, and direct-publication checks passed | None for Milestone 1; keep both flags off and add a safe public projection only when Milestone 2 implements discovery against real publication eligibility |
| 2. Discovery/manual availability | Complete | `041c2dd93063dd330ec37dd5788d06729ab2b38e` | `8c9f306dd9c82d867c0a364ff81fa6b0509a44f3` | `npm run verify:full-stack` passed at the immutable feature commit with 105 client tests, 133 API unit tests, 26 PostgreSQL integration tests, 73 desktop tests, 15 private-tutor tests, Expo Doctor 21/21, and a successful web export of discovery, public-profile, and tutor-availability routes; focused tests cover deterministic filters/favorites, safe public projection, optimistic availability replacement, lead time, buffers, unavailable exceptions, calendar-busy exclusion, DST gaps/folds, result/window bounds, loading/empty/error/retry, cancellation, and duplicate-favorite suppression | Authenticated browser/Electron two-role smoke requires a valid local Clerk development configuration, which is intentionally absent in this isolated worktree; Electron reached the renderer and failed closed at authentication, while iOS Simulator services were unavailable. Deterministic client and API journey evidence passed; no live provider evidence is claimed |
| 3. Google free/busy | Complete | `67deecbf2d46952c18c6fa8f8369a58c08433d4b` | `4c962678b3eb4cb18299e4ad03bb2d2f97a31e51` | `npm run verify:full-stack` passed at the immutable feature commit with 110 client tests, 143 API unit tests, 27 PostgreSQL integration tests, 73 desktop tests, 15 private-tutor tests, Expo Doctor 21/21, and a successful web export; fake-provider and HTTP-contract tests prove the single free/busy scope, exact redirect binding, actor-bound signed state, replay rejection, AES-GCM token boundary, response-size/time/result bounds, idempotent fresh-cache reuse, transient stale behavior, revoked-token reconnect behavior, safe slot suppression, and absence of event-content columns | Real Google development OAuth connect/refresh/revoke/reconnect remains unproven because this task has no authorized Google OAuth project, client credentials, approved redirect registrations, or externally-proven encryption-key provenance. Both calendar flags remain off; no Google account or configuration was mutated |
| 4. Messaging/coordination | Complete | `4571a7dab0f417bc1aca10420371881de837f4c5` | `3052ea23da493f38fa717fb11763c8376625df44` | `npm run verify:full-stack` passed at the immutable feature commit with 121 client tests, 148 API unit tests, 28 PostgreSQL integration tests, 73 desktop tests, 15 private-tutor tests, Expo Doctor 21/21, and a successful web export of inbox, thread, and report-operations routes; focused coverage proves participant-only access and guessed-ID denial, safe literal-text rendering, pre-booking contact/link rejection, idempotent sends, rate limits, cursor paging, bidirectional blocks, report-scoped capability/audit boundaries, bounded retention with reported-message preservation, exact-host HTTPS meeting links, notification preference suppression, job deduplication, lease ownership, and retry state | Authenticated browser/Electron two-actor smoke and real email delivery remain external because this isolated worktree has no valid Clerk development identities or approved email sender/domain; production retention duration and meeting-host allowlist require legal/operator approval. Messaging flags remain off and configuration fails closed until those values exist; no live email or meeting-provider evidence is claimed |
| 5. Booking/checkout | Complete | `4a7b5c547e6e450180982b954d027144c52ee874` | `b475ac38c7cd1c197e125f9024bed60c6d626327` | `npm run verify:full-stack` passed at the immutable feature commit with 125 client tests, 153 API unit tests, 29 PostgreSQL integration tests, 73 desktop tests, 15 private-tutor tests, Expo Doctor 21/21, and web export of booking, payout-onboarding, and protected detail routes; deterministic Stripe adapter tests prove pinned API version, server amount/redirect/transfer-group ownership, idempotency headers, bounded timeouts, signed raw-body verification, and event-time parsing; PostgreSQL evidence proves advisory-lock overlap exclusion, immutable booking/policy/price snapshots, 20% money conservation, changed-input conflict, participant isolation, replay/order/account checks, and idempotent system-message confirmation; checkout ambiguity remains retryable with the same provider key and UI recovery never initiates a second payment | No live Stripe claim is made: Connect account ownership, merchant/legal configuration, country support, production/sandbox credentials, webhook endpoint, real sandbox onboarding/success/cancellation/decline/account-switch evidence, and migration application remain external gates. Commerce flags remain off and RevenueCat is unchanged/separate; deterministic fake-adapter and local PostgreSQL evidence is sufficient to continue repository work |
| 6. Completion/money/reviews | Complete | `1dd53e61d47fe04ebc9c409dd6ac0f71d35ab782` | `f4e50a52103d5f65707f7b2af8fe5d582c1ed477` | `npm run verify:full-stack` passed at the immutable feature head with 125 client tests, 153 API unit tests, 30 PostgreSQL integration tests, 73 desktop tests, 15 private-tutor tests, Expo Doctor 21/21, and a successful web export; focused evidence covers snapshotted 12-hour cancellation rules, reschedule revisions and reminder replacement, both no-show outcomes, 24-hour disputes, first-weekly-window payout eligibility, refund/transfer/reversal idempotency, provider mismatch and ambiguity, stale leases, eight-attempt exhaustion, capability-scoped audited recovery, exact-deadline transfer/dispute races, append-only ledger conservation, tutor-only earnings, one eligible verified review, ineligible disputed-review denial, and published-rating aggregation | Live Stripe refund/transfer/reversal and authenticated learner/tutor/operator browser journeys remain external because no authorized Stripe account, Clerk identities, or provider credentials exist in this worktree. Worker deployment, legal payout approval, named operators, migration application, and activation remain later operational gates; commerce stays default off and no live money evidence is claimed |
| 7. Learning bridge | Not started | — | — | — | — |
| 8. Hardening/pilot readiness | Not started | — | — | — | — |

Allowed statuses are `Not started`, `In progress`, `Blocked`, and `Complete`. A `Blocked` entry must
identify the exact decision, approval, failing evidence, or external state required to resume.

## Post-MVP extension gate

The original product opportunity includes onboarding tutoring companies and other language-service
providers. Preserve that outcome as the first evaluated extension, but do not build unused
organization machinery into the individual-tutor MVP.

Begin an organization milestone only after the core pilot proves reliable booking, payment, support,
and tutor retention. That milestone may add:

- an organization application and verified organization profile;
- organization administrators with explicit roster capabilities;
- tutors who keep individual identities while accepting an organization affiliation;
- organization-owned offerings and booking assignment rules;
- separate organization, tutor, and platform financial allocations with immutable ledger evidence;
- organization reporting that exposes no unrelated learner or tutor data;
- removal and transfer rules that preserve existing bookings and payment history.

Do not reuse affiliate memberships as tutoring-organization authorization. Do not allow a company
administrator to impersonate a tutor, read every tutor conversation, or silently redirect an owed
tutor payment. Plan and review this extension as its own vertical slice after the MVP checkpoint
ledger is complete.

## Rollout and rollback

Rollout stages:

1. code merged with server and client flags off;
2. migrations applied by the authorized operator and privileges verified;
3. workers and maintenance deployed but producing no unauthorized marketplace effects;
4. internal actor allowlist in Stripe/Google sandbox;
5. production configuration verified with flags still off;
6. one approved tutor and one internal learner live transaction;
7. bounded invite-only pilot;
8. broader language-agnostic availability only after support and marketplace health gates pass.

Rollback uses flags and forward-compatible data:

- prevent new discovery, conversations, slot holds, and checkout;
- preserve access to already confirmed bookings and support operations;
- stop new transfer eligibility while allowing authorized reconciliation;
- leave additive schema in place during application rollback;
- roll forward money corrections rather than rewriting or deleting ledger history;
- revoke/rotate compromised provider credentials and mark affected operations for reconciliation;
- never strand a paid learner or erase an owed tutor balance by disabling the UI.

## Success and health measures

The pilot must observe the complete funnel rather than vanity signups:

- approved tutors with genuinely bookable hours;
- percentage of searches showing at least one eligible near-term slot;
- tutor profile to paid-introduction conversion;
- completed introduction to second-booking conversion;
- payment failure and recovery rate;
- booking conflict, cancellation, learner no-show, and tutor no-show rates;
- calendar stale/revoked rate;
- message report and block rate;
- refund, dispute, transfer failure, and manual-intervention rate;
- median support resolution time;
- tutor net earnings and retained active supply;
- learner follow-up completion when learning context is enabled;
- contribution margin after processing, Connect, refund, support, notification, and operational costs.

Targets must be set before the pilot begins. Do not expand supply or languages merely because account
creation grows.

## Decisions and approvals still required before live activation

- legal merchant-of-record and contractor classification;
- platform entity, Stripe Connect account/configuration, supported countries, and loss liability;
- initial currency and tax/invoice/reporting obligations;
- marketplace terms, privacy notice, tutor agreement, cancellation/refund policy, and acceptable-use
  policy;
- message, audit, calendar-cache, application, and financial-record retention/deletion periods;
- production Google OAuth project ownership and consent-screen verification;
- production email sender/domain and abuse handling;
- named operators for tutor approval, safety reports, refunds, disputes, and payout holds;
- final app-store review of the exact one-to-one, external-meeting, no-recording purchase flow;
- explicit approval for migration application, deployment, live transaction, and feature enablement.

These decisions do not block deterministic local development with fakes or approved sandboxes unless
their answer would change the public contract or data model. They do block production activation.

## Autonomous execution brief

Use this brief to start the implementation after the plan is approved:

```text
Goal: Implement the Human Tutor Marketplace MVP defined in
docs/product/HUMAN-TUTOR-MARKETPLACE-MVP-EXECUTION-PLAN.md through its ordered milestones.

Start in a new clean GlideLingo worktree. Fetch origin/main, record the SHA, reconstruct the live PR
and migration queue, and complete Milestone 0 before editing implementation files. Treat the plan's
settled decisions, authority boundaries, exclusions, state machines, milestone gates, and stop
conditions as the execution contract.

Work continuously and autonomously through local milestones while every entry/exit gate passes.
Implement the smallest coherent vertical slice for the current milestone only. Reuse the repository's
Expo/Electron, FastAPI modular-monolith, Clerk, PostgreSQL, migration, error, idempotency, feature-flag,
and verification patterns. Keep RevenueCat Pro billing and affiliate finance separate from tutor
marketplace commerce. Do not build video, recording, group lessons, subscriptions, AI matching,
multiple calendar providers, organizations, attachments, microservices, or other excluded scope.

After each milestone, run its focused tests and canonical repository commands, inspect the complete
diff, update the checkpoint ledger with immutable SHAs and evidence, and continue only when the exit
gate passes. Stop for any listed stop condition or when production credentials, vendor mutation,
shared migration application, deployment, live money, remote GitHub mutation, or feature enablement
would be required. Report the exact blocker and the smallest authorization or decision needed.
```

## Immediate next action

Review and approve this contract, especially the 20% commission, 12-hour cancellation cutoff,
24-hour dispute window, adults-only scope, one-currency launch, Google-free/busy-only calendar access,
and delayed Stripe transfer model. Then execute Milestone 0 only against a freshly fetched
`origin/main`; do not begin schema or UI work from this document's audit SHA.
