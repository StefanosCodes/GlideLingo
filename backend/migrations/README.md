# Backend migrations

Migrations are reviewed SQL and are not executed by an API request or startup hook. Before enabling
the lesson tutor, an operator must apply `001_lesson_tutor_guard.sql` to the target database with a
credential authorized for DDL with `psql --set ON_ERROR_STOP=1`, then verify the table and indexes.
The migration uses one transaction, so a failed statement leaves no partial schema. It must be run by
a migration operator that owns the target schema and may grant privileges. The final statement grants
only `SELECT`, `INSERT`, and `UPDATE` on this table to the existing `glidelingo_app` runtime
role; verify those grants—and that `DELETE` is denied—while connected as that runtime role before
activation. Run retention with a separate maintenance credential that has `DELETE` on this table,
not with the internet-facing API runtime role.

Completed, retryable, and ambiguous tutor rows are retained for seven days so client retries receive a
stable result throughout the supported idempotency window. Run the two bounded statements in
`maintenance_lesson_tutor_guard.sql` at least daily after activation, repeating until both affect
zero rows. The first statement terminalizes abandoned leases even when no later admission arrives:

```sql
WITH abandoned AS (
  SELECT ctid
  FROM lesson_tutor_turn_guard
  WHERE status = 'in_progress'
    AND updated_at < now() - interval '120 seconds'
  ORDER BY updated_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
UPDATE lesson_tutor_turn_guard AS guard
SET status = 'ambiguous'
FROM abandoned
WHERE guard.ctid = abandoned.ctid;
```

Then delete expired terminal rows:

```sql
WITH expired AS (
  SELECT ctid
  FROM lesson_tutor_turn_guard
  WHERE status <> 'in_progress'
    AND updated_at < now() - interval '7 days'
  ORDER BY updated_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM lesson_tutor_turn_guard AS guard
USING expired
WHERE guard.ctid = expired.ctid;
```

The tutor flags must remain false until both migration and recurring retention maintenance are in
place. Admission and maintenance both convert an `in_progress` row older than its conservative
120-second lease to `ambiguous`, which remains a non-retryable `409` for the same idempotency key
during the supported seven-day idempotency window. The maintenance path ensures an idle service
cannot retain abandoned rows forever.

## RevenueCat entitlement state

`002_revenuecat_entitlements.sql` is an additive, operator-run migration for the server-owned
`pro` authorization boundary. Apply it after `001_lesson_tutor_guard.sql` with the same DDL-capable
operator and `psql --set ON_ERROR_STOP=1`. Apply it through a separate short-lived Cloud SQL built-in
operator after `SET ROLE cloudsqlsuperuser`; the migration explicitly transfers both tables to that
non-login system owner. The API must not run either migration at startup, and `glidelingo_app` must
never own the tables or maintenance procedure.

The runtime role receives only `SELECT`, `INSERT`, and `UPDATE` on the current entitlement table,
and only `SELECT` and `INSERT` on the webhook event ledger. It receives no DDL or `DELETE` grants.
Rows store only a keyed pseudonymous actor reference, the exact `pro` entitlement, store environment,
active/expiry state, and provider verification timestamps. Raw Clerk IDs, email, phone, product IDs,
transaction IDs, receipts, aliases, and complete webhook bodies are never persisted.

After `002`, apply `003_revenuecat_webhook_maintenance.sql` with the same DDL-capable operator. It
creates a passwordless, one-connection maintenance role and a `SECURITY INVOKER` procedure containing
one bounded delete. Each call removes at most 1,000 rows in one transaction. The role's
target-database and target-schema privileges are revoked before its exact grants are reapplied: it can
only connect, use the target schema, and select/delete the webhook ledger; it cannot access entitlement
state, insert webhook rows, or run DDL. `maintenance_revenuecat_webhooks.sql` is the canonical manual
`CALL` for that procedure.

In development, enable Cloud SQL `pg_cron` and schedule the procedure hourly with
`infra/gcp/scripts/schedule-revenuecat-webhook-maintenance.sql`. The job must be owned by
`glidelingo_revenuecat_maintenance`, not the API login or the DDL operator. Its null password prevents
normal external password authentication while the Cloud SQL background worker executes with only the
role's explicit table grants. Hourly 1,000-row transactions can retire up to 24,000 expired events per
day without an unbounded cleanup transaction. The 30-day event-ID window covers RevenueCat's automatic
and operator-triggered webhook retries while bounding the deduplication ledger. Current entitlement rows
remain until account deletion or an operator-approved privacy purge; those operations must derive the
same `rcusr_v1_` actor reference with the production pseudonym key and run through a non-runtime
maintenance identity.

Cloud SQL grants `cloudsqlsuperuser` to built-in users by default. Before activation, revoke all
inherited roles from `glidelingo_app` with Cloud SQL's `users assign-roles --revoke-existing-roles`
operation, reconnect, and prove the login has no `cloudsqlsuperuser`, `CREATEROLE`, `CREATEDB`, schema
`CREATE`, table ownership, `DELETE`, or DDL capability. Direct grants from migration `002` remain the
runtime contract.

Keep `GLIDELINGO_REVENUECAT_ENABLED=false` and `GLIDELINGO_LESSON_TUTOR_ENABLED=false` until migrations
`002` and `003`, recurring webhook-ledger maintenance, runtime-role demotion, webhook secrets, the
least-privileged app public SDK key used by the server's read-only Customer Info request, environment
filter, and live sandbox evidence are all in place. The development Terraform contract must pin all
four RevenueCat Secret Manager version numbers before the flag can be enabled.

## Human tutor marketplace application core

`006_human_tutor_marketplace_core.sql` is the first additive human-tutor marketplace migration.
Numbers `004` and `005` are reserved by the in-flight affiliate and durable billing-event stack; do
not renumber or apply `006` until the integration train has reconciled and applied those predecessors.
The migration creates only the tutor application, normalized language/specialty, unpublished private
profile, one optional credential, one USD offering draft, immutable commission/cancellation policy
versions, operator-capability, and append-only audit facts required by Milestone 1. It deliberately
creates no learner discovery, booking, payment, transfer, calendar, or messaging tables.

Apply it with the DDL-capable operator after `SET ROLE cloudsqlsuperuser`. The API runtime receives no
ability to grant operator capabilities, alter immutable policy versions, set payout readiness,
directly activate an offering, create an approved or published record, update or delete audit events,
or run DDL. Database triggers preserve application transitions, profile/application ownership,
policy types, the single-currency rule, and active-offering publication eligibility even if a caller
bypasses the service. Publication and suspension take locks in application/profile/offering order so
their concurrent result is always suspended and private; first credential/offering creation locks the
owning profile so equivalent retries converge instead of surfacing a uniqueness failure.
Seed the required `review_tutor_applications`, `manage_tutor_status`, and
`verify_tutor_credentials` capabilities through an approved operator procedure using the exact
`mktusr_v1_` pseudonym derived with the environment's marketplace pseudonym key; never store the raw
Clerk user ID in these tables.

Keep `GLIDELINGO_HUMAN_TUTOR_MARKETPLACE_ENABLED=false` until the migration and grants are verified,
the server-only pseudonym key is pinned, Clerk is configured, and an explicit test-actor allowlist is
present. This migration does not enable discovery, messaging, calendar access, payments, or payouts.

## Human tutor marketplace addenda

After the live migration queue includes separately owned `004`, `005`, and `007`, apply the human
tutor marketplace addenda in numeric order:

- `008_human_tutor_marketplace_discovery_availability.sql` adds public-safe discovery inputs,
  recurring manual availability/exceptions, dialects, and actor-scoped favorites.
- `009_human_tutor_marketplace_google_calendar.sql` adds one-time signed OAuth state, encrypted token
  storage, and bounded busy intervals without calendar event content.
- `010_human_tutor_marketplace_messaging.sql` adds participant conversations, literal text messages,
  blocks, reports/access audit, bounded rate events, preferences, and durable notification jobs.
- `011_human_tutor_marketplace_booking_checkout.sql` adds Connect status, protected meeting config,
  booking holds and immutable authority/price/policy snapshots, database overlap prevention, signed
  Stripe event deduplication, and reconciliation jobs.
- `012_human_tutor_marketplace_lifecycle_money_reviews.sql` extends booking states, records schedule
  revisions, durable refund/transfer/reversal and reminder jobs, append-only conservation ledgers, and
  verified-booking reviews. Its constraint replacement is intentional and occurs inside one
  transaction; it does not delete booking facts.
- `013_human_tutor_marketplace_learning_bridge.sql` adds explicit booking-scoped learner consent,
  append-only consent audit, bounded learning selections, and tutor follow-up that has no foreign key
  or write path to official learning evidence.
- `014_human_tutor_marketplace_hardening.sql` adds bounded multi-credential and multi-offering
  ownership, exact atomic publication, participant action rate evidence, transition/review audit
  records, strict review timing, money-operation immutability, bounded server-clock retention, and a
  separate NOLOGIN payment-authority role. The DDL operator needs temporary `ADMIN OPTION` on
  `glidelingo_app` so `014` can make the payment role inherit ordinary data-plane rights; runtime
  LOGIN principals are provisioned separately as documented in the runbook.

Use the same DDL-capable operator and transactional `psql --set ON_ERROR_STOP=1` posture as `006`.
Never run these migrations from API startup. Revoke inherited Cloud SQL roles from
`glidelingo_app`, then verify each file's exact grants while authenticated as that runtime login.
Audit, transition, webhook, consent, schedule-revision, and money-ledger facts must not be updated or
deleted by the runtime. The runtime must not own tables/functions, create schema objects, grant
capabilities, bypass publication/payout checks, or disable overlap, transition, eligibility, or
conservation triggers.

All matching server/client flags, including the independent marketplace acquisition switch, remain
false through migration, worker/maintenance deployment, provider provenance, real sandbox journeys,
support/legal approval, and controlled-pilot authorization. Operational activation and rollback are
defined in `docs/infra/HUMAN-TUTOR-MARKETPLACE-RUNBOOK.md`.
