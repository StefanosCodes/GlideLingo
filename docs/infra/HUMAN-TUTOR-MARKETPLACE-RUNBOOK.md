# Human tutor marketplace operations and activation runbook

## Status and safety boundary

This runbook describes repository-ready behavior. It is not approval to apply migrations, create or
modify vendor resources, deploy workers, move money, enable flags, or admit users. All human tutor
flags remain false by default. No live Google, Stripe, Clerk, email, iOS, Android, or production pilot
evidence is represented by deterministic adapters or local PostgreSQL tests.

The marketplace provides one-to-one, text-coordinated tutoring with protected external meeting URLs.
It does not provide platform audio/video, recording, transcripts, attachments, group lessons,
subscriptions, AI matching, or RevenueCat payment authority. RevenueCat remains an independent Pro
entitlement boundary.

## Readiness is four separate decisions

| Plane | Repository state | Approval needed before activation |
| --- | --- | --- |
| Code | Implemented behind default-off flags; deterministic and PostgreSQL verification required at the final immutable head | Review-ready PR approval and merge |
| Integration | Google and Stripe adapters are production-shaped, bounded, and fail closed | Account ownership, environment provenance, real sandbox journeys, webhook registration, redirect registration, and email delivery evidence |
| Operations | Durable money jobs, capability-scoped operator routes, structured safe worker events, recovery APIs, and this runbook exist | Deployed workers and maintenance, dashboards, alert routing, support staffing, operator capability grants, and rehearsal evidence |
| Enablement | Acquisition has an independent rollback switch and the actor allowlist is mandatory | Applied migrations, legal/policy/privacy/tax/store approval, named owners, approved live transaction, and explicit flag-change approval |

Repository completion does not imply that any later plane is ready.

## Migration order and least privilege

Use a short-lived DDL operator and `psql --set ON_ERROR_STOP=1`. Never apply migrations from API
startup or with a runtime login. For migration `014`, the DDL operator must have `ADMIN OPTION` on
`glidelingo_app` so it can compose the NOLOGIN payment role transactionally; remove that temporary
membership after the migration. Reconstruct the live migration queue immediately before application;
do not rely on this document as evidence that another branch has merged.

Expected order is `001`, `002`, `003`, the separately owned `004` affiliate and `005` billing
migrations, `006` marketplace core, the integration-owned `007`, then marketplace `008` through
`014`. Migrations `008`–`014` are additive except for the intentional forward-compatible booking
constraint replacement in `012` and the intentional removal of single-credential/single-offering
uniqueness in `014`; each file is one transaction and preserves existing booking facts.
Do not renumber around an unmerged predecessor.

Provision two distinct environment-specific LOGIN principals without recording their credentials:

- the general API login is a member of `glidelingo_app` only;
- the payment-authority login is a member of `glidelingo_marketplace_payment_worker` only; that
  NOLOGIN role inherits `glidelingo_app` and adds the transition-evidence, money-ledger, money-job,
  and verified-payment function rights required by the API and marketplace worker;
- `glidelingo_app` is not a member of, and cannot assume,
  `glidelingo_marketplace_payment_worker`; neither login is an owner, superuser, DDL role, or member
  of `cloudsqlsuperuser`.

Set the general URL in `GLIDELINGO_DATABASE_URL` and the payment login URL in
`GLIDELINGO_HUMAN_TUTOR_PAYMENT_DATABASE_URL`. String inequality is only an early configuration
guard. While commerce is enabled, `/health/ready` also connects through both URLs and fails closed
unless the connected users are distinct, non-superusers with the exact composed membership and the
general principal lacks direct transition, money insertion, and payment-confirmation authority.

Before any flag change, connect as the general runtime login and prove:

- no schema `CREATE`, `CREATEDB`, `CREATEROLE`, ownership, or inherited `cloudsqlsuperuser`;
- no `UPDATE` or `DELETE` on transition, access, consent, and money ledgers;
- no direct capability grant, policy mutation, application approval, tutor publication, payout-ready
  mutation, or trigger-function execution beyond the explicitly granted wrapper;
- the expected bounded runtime grants in each reviewed migration and no public function execution;
- overlap, booking-state, review-eligibility, money-conservation, and learning-authority triggers are
  installed with their pinned `search_path`.

Then connect as the payment-authority login and prove the readiness role contract plus one controlled
confirmation, refund, transfer, and reversal-to-refund flow. Never grant the payment role to the
general login or use an owner URL to satisfy this check.

A failed statement must leave no partial schema. Re-run the production-shaped migration and runtime
privilege tests before proceeding; never repair a critical journey with an ad hoc database write.

## Configuration provenance without secret disclosure

Record only resource identities and metadata in the activation ticket. Never paste secret payloads,
OAuth tokens, webhook bodies, raw Clerk IDs, payment identifiers, calendar event content, or meeting
tokens into tickets, dashboards, or logs.

For each environment, record and independently verify:

- GCP project number/name, Cloud Run service and revision, Cloud SQL instance/database, runtime
  service account, both distinct database login identities/role memberships, and Secret Manager
  resource plus pinned numeric version for every secret;
- Clerk instance/issuer, JWKS URL host, audience, authorized parties, and the identities of the
  allowlisted internal test actors;
- Stripe account ID shown by an authenticated account-retrieval request, livemode, Connect country
  and capabilities, pinned API version, webhook endpoint identity, signing-secret version, and the
  exact expected platform account ID/environment pair;
- Google Cloud project/client ID, OAuth consent-screen status, the registered redirect URIs, token
  encryption-key resource/version, and the single free/busy scope;
- approved HTTPS meeting hosts, email sender/domain, retention decisions, and alert/support owners.

Production must use independently owned production resources. A production process that resolves to
a sandbox, shared, unpinned, or unowned resource fails closed and stops activation.

## Flag order and rollback

Server and matching client flags start false. Enable only for explicitly approved allowlisted actors,
in this order: base marketplace, optional Google calendar, messaging, commerce, learning bridge, then
acquisition. Keep `GLIDELINGO_HUMAN_TUTOR_PAYOUT_EXECUTION_ENABLED` false until payout ownership and
legal approval are separately evidenced; it may become true only while commerce is enabled. Child
server flags require the base flag and their complete configuration. The client is never payment or
authorization authority.

`GLIDELINGO_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED` and
`EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ACQUISITION_ENABLED` are the first rollback controls. Set both
false to stop public discovery, favorites/slots, new pre-booking conversations, and new checkout while
preserving tutor administration, participant messaging for existing conversations, booking history,
lifecycle actions, earnings, and capability-scoped operator recovery.

For a money incident, set `GLIDELINGO_HUMAN_TUTOR_PAYOUT_EXECUTION_ENABLED=false`. The worker then
stops claiming transfers while continuing checkout reconciliation, refunds, reversals, reminders,
calendar refresh, notification work, and retention. Do not terminate a worker during an external
provider request; allow the bounded request and database lease to resolve, or let the durable
idempotency key and stale-lease recovery take over. Leave additive tables in place, preserve ledgers
and audit facts, and roll corrections forward. A full base-flag shutdown is an emergency measure and
requires a separate support path for every paid or owed booking.

## Worker deployment

The marketplace worker command is:

```sh
npm run marketplace:worker -- --poll-seconds 2
```

Use `--once` only for a deployment probe. Start with one worker per environment and a database
connection budget approved by the database owner. In bounded recovery order, the worker expires only
provider-free local holds, reconciles or explicitly expires provider checkout sessions, processes
refund/transfer/reversal operations, sends reminders and message notifications through the narrow
delivery adapter, refreshes Google free/busy caches, and applies message retention. Each durable queue
uses a 60-second lease and stable provider idempotency keys where applicable; transient work retries
with bounds and terminalizes after eight attempts. Money recovery requires `manage_bookings`.
Revoked Google access becomes reconnect-required, and a new OAuth connection resets its refresh job.
The worker may start once the base marketplace flag is enabled: it skips all commerce-owned expiry,
reconciliation, money, and reminder queues until commerce is enabled, while independently enabled
calendar and messaging queues remain available during staged activation.
Each poll performs a bounded unit or batch from every enabled queue, so a sustained checkout or hold
backlog cannot starve refunds, reversals, reminders, notifications, calendar refresh, or retention.
`SIGTERM` and `SIGINT` stop after the current bounded claim; no actor, booking, payment, provider,
token, message content, or calendar event content is logged.

The approved email adapter, sender ownership, maintenance cadence, and alert routing still must be
deployed and evidenced before activation. A deterministic adapter result or queued database row is
not evidence that an email or reminder was delivered.

## Dashboards and alerts

Build environment-scoped metrics from bounded aggregate database reads plus safe structured events.
Do not label by actor, tutor, booking, conversation, payment, event ID, URL, message body, or free text.
Targets and paging thresholds require approval before the pilot; the conservative starting thresholds
below are rehearsal defaults, not claimed production SLOs.

| Signal | Source and safe dimensions | Rehearsal alert |
| --- | --- | --- |
| Booking failures | booking state and transition reason category, environment | page on any sustained failure spike for 5 minutes; stop acquisition if payment safety is uncertain |
| Overlapping-slot conflicts | conflict-category counter from checkout attempts | ticket on trend; page if confirmed overlap is ever observed (expected invariant: zero) |
| Webhook age/failure | age of newest verified Stripe event and safe outcome counter | page if expected traffic exists and age exceeds 10 minutes, or verification/provider mismatch occurs |
| Calendar staleness | aggregate connection status/cache age | warn above 5% stale/reconnect among connected pilot tutors; acquisition already suppresses unsafe slots |
| Checkout reconciliation | oldest queued/retryable checkout reconciliation age and terminal count | page on any terminal result or a ready job older than 5 minutes; stop acquisition if provider expiry is uncertain |
| Reminder lag | oldest available queued reminder age and terminal count | warn at 5 minutes; page at 15 minutes or any terminal reminder |
| Notification lag | oldest available message-notification age and terminal count | warn at 5 minutes; page at 15 minutes or any terminal result |
| Refund/transfer failure | money-operation kind/status/attempt and worker event outcome | page on terminal or provider-mismatch; warn on retry backlog older than 5 minutes |
| Dispute rate | disputed bookings divided by completed/terminal bookings over a fixed window | review daily; threshold must be approved before pilot |
| Worker saturation | ready/leased backlog, oldest available age, poll/error outcome | warn when oldest ready job exceeds 2 minutes; page at 10 minutes or repeated worker errors |

Also track blocks/reports, cancellations, both no-show categories, manual intervention, support
resolution time, tutor earnings, bookable supply, funnel conversion, and contribution margin. Counts
must be minimum-cohort or otherwise privacy-safe before display.

## Incident procedures

Every incident opens an immutable ticket containing environment, time range, symptom category,
approved operator, safe aggregate evidence, decisions, and outcome. Do not paste private content.

### Tutor suspension

Confirm `manage_tutor_status`, suspend through the operator API, verify the profile and offering become
private atomically, disable new acquisition if safety scope is uncertain, enumerate existing bookings
through the capability-scoped booking route, notify participants through the approved support path,
and handle refunds/owed earnings through normal state transitions. Never delete history or impersonate
the tutor.

### Calendar failure or revoked access

Verify aggregate freshness/status and bounded provider health. Stale or revoked data must suppress
slots rather than appear current. Ask the tutor to reconnect through the signed OAuth flow; never copy
tokens or calendar event content. Disable the calendar child flag if systemic while preserving manual
availability only when that degraded mode has explicit operational approval.

A tutor profile time-zone change intentionally deletes the old wall-clock rules and exceptions in the
same transaction. The tutor must explicitly recreate availability in the new zone; operators must not
translate or restore the old rows by hand.

### Stuck payment or duplicate/ambiguous provider event

Turn acquisition off if scope is uncertain. Compare signed webhook/retrieval outcome to the persisted
safe state using the original idempotency key and verified account/environment. Allow reconciliation
to converge duplicate and out-of-order events. After the local hold deadline, reconciliation first
expires an open provider session; a verified late payment keeps inventory expired and queues one full
idempotent compensating refund. Do not initiate a second payment or manually mark a booking paid.
Provider mismatch, unverifiable ownership, or an exhausted reconciliation job pages the money owner.

### Refund, failed transfer, dispute, or reversal

Use only the booking lifecycle/operator APIs with the snapshotted policy. Confirm the 12-hour cutoff,
24-hour dispute window, 20% commission version, current ledger sum, and provider environment. Let the
durable operation use its persisted idempotency key. A retryable result stays queued; an ambiguous or
provider-mismatch result is reconciled; an eight-attempt terminal result needs an audited
`manage_bookings` recovery. Never update or delete ledger rows. A reversal and refund must conserve
the original charge exactly.

### Secret rotation

Set acquisition false, identify the affected resource/version without reading it, create a new pinned
version through the approved owner, deploy with flags off, verify account/environment provenance and
signature/OAuth behavior, revoke the old version, then repeat controlled acceptance. Token encryption
key rotation needs a separately reviewed data-migration plan; do not strand encrypted refresh tokens.

### Feature disable and application rollback

Set both acquisition flags false first and verify new discovery/conversation/checkout receives the
fail-closed response while existing confirmed bookings and operator routes remain usable. Drain
workers only when money safety permits. Roll back application revisions with schema `006`–`014` left
in place. Re-run reconciliation and ledger-conservation checks. Do not downgrade schemas, erase audit
facts, or disable every support surface for a paid learner or owed tutor.

## Controlled acceptance matrix

The following matrix must be executed with real authorized sandbox resources and then the explicitly
approved production transaction. Local fakes prove contracts only. Attach sanitized evidence and an
immutable application SHA for every row; any manual database repair is a stop condition.

| Journey | Required cases | Current external evidence |
| --- | --- | --- |
| Tutor onboarding | incomplete, complete, requirements changed, disabled | Not run; Stripe/Clerk ownership required |
| Calendar | connect, fresh busy exclusion, timeout, revoked token, reconnect | Not run; Google project, redirects, and actors required |
| Messaging | send, block, report, unauthorized/guessed ID, retention, account switch | Not run; Clerk actors and approved sender required |
| Checkout/webhook | success, cancel, decline, timeout, duplicate, out-of-order, wrong account/environment | Not run; Stripe account/webhook and actors required |
| Concurrency | simultaneous overlapping attempts with one winner | Local PostgreSQL passed; real sandbox not run |
| Lifecycle | reschedule; cancellation before/after cutoff; both no-shows; complete; dispute | Local deterministic/PostgreSQL passed; real sandbox not run |
| Money | full refund, approved late/partial policy result, transfer success/retry/ambiguity/duplicate/reversal | Local deterministic/PostgreSQL passed; live money not authorized |
| Learning bridge | consent, revoke, expiry, no-course context, tutor follow-up, unrelated actor | Local deterministic/PostgreSQL passed; Clerk journey not run |
| Clients | learner/tutor/operator UI; loading/empty/error/cancel/race/accessibility; sign-out/account switch | Automated client contracts passed; browser/Electron/native authenticated run not available |
| Rollback | acquisition disabled while existing confirmed booking and operator support remain usable | Deterministic service/route tests required at final SHA; deployed rehearsal not run |

Activation remains blocked until the matrix, actual browser/Electron/iOS/Android shipping journeys,
monitoring, worker/maintenance deployment, least-privilege production proof, support ownership,
policy/privacy/terms/tax/contractor/store approvals, migration authorization/application, and one
approved real allowlisted production transaction all pass.

## Stop conditions

Stop immediately if the verified SHA changes, an account or environment cannot be proven, a migration
is destructive or non-transactional, a secret is unpinned, a critical journey requires manual database
repair, money cannot be conserved, participant/capability authorization fails, or any required owner
or approval is unknown. Keep flags off, preserve evidence, and request the smallest missing approval;
never weaken a guard to make activation pass.
