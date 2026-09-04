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

## Affiliate identity and attribution foundation

`004_affiliate_identity_attribution.sql` is the additive, operator-run foundation for the affiliate
program's server-owned identity, authorization, and attribution boundary. Apply it only after migrations
`001`–`003`, with the same short-lived DDL operator pattern and `psql --set ON_ERROR_STOP=1`. The API
does not run this migration at startup. The migration creates no creator, program, version, campaign,
link, code, membership, offer, commission, ledger, transfer, or payout defaults and makes no provider
call.

The migration stores Clerk identities only as keyed `affusr_v1_` pseudonymous references. It creates
explicit creator roles and individually scoped staff capabilities with validity and revocation fields;
authorization reads those rows on each request, so revocation is effective immediately without waiting
for the Clerk session to expire. The initial platform `membership_admin` capability must be inserted by
an authorized migration operator after deriving the principal reference with the same environment-
specific server key. The public API cannot bootstrap an administrator.

Published program versions are immutable and overlapping published effective intervals are rejected.
There is no default policy document: an operator-created draft must contain explicit policy, and a
published version must include every required policy section and a reviewed SHA-256 policy hash. Active
traffic also requires an explicitly active program, published effective version, active campaign,
active link, and active creator.

Referral resolution stores only link/campaign/program references and timestamps. It does not store an
IP address, user agent, email, phone, raw Clerk subject, or raw handoff token. Handoff tokens contain
256 random bits, are stored only as SHA-256 digests, expire exactly 15 minutes after issuance, and can
be consumed once. Locked attribution evidence is protected from identifier or lock mutation by a
database trigger. Membership grants, revocations, attribution binds, and denied capability checks append
audit records; the runtime role receives no `DELETE`, DDL, program-policy mutation, creator mutation, or
audit-update privilege.

All four server switches remain false by default:

```dotenv
GLIDELINGO_AFFILIATES_ENABLED=false
GLIDELINGO_AFFILIATE_REFERRAL_RESOLUTION_ENABLED=false
GLIDELINGO_AFFILIATE_ATTRIBUTION_BINDING_ENABLED=false
GLIDELINGO_AFFILIATE_MEMBERSHIP_ADMIN_ENABLED=false
GLIDELINGO_AFFILIATE_PRINCIPAL_PSEUDONYM_KEY=
```

Do not enable any switch until migration `004` is applied through the approved operator, the
environment-specific pseudonym key is pinned through the server secret mechanism, the exact Clerk
issuer is configured for authenticated routes, the bootstrap administrator is reviewed, privacy
retention/rate controls are approved, and the authorization, expiry, replay, locking, and cross-principal
negative tests pass in that environment. This migration does not authorize offers, discounts, financial
intake, commission, ledger entries, provider credentials, transfers, or payouts.

## Durable billing event intake

`005_billing_event_intake.sql` is sequenced after affiliate foundation migration `004`. It is additive
and operator-run; the API and worker never execute DDL. Apply it only through the versioned migration
operator after `004`. The canonical production runner records both files in numeric order.

The migration creates `billing_event_provider_actor`, `billing_event_inbox`, and
`billing_event_delivery`. Provider actor identifiers required for a fresh entitlement read are stored
only as authenticated ciphertext outside the inbox. Inbox identity is unique across provider,
environment, provider app/account context, and provider event ID. Each reviewed consumer gets one
delivery row with independent lease, retry, completion, and manual-review state. Inbox and delivery
records are durable; this slice intentionally adds no deletion or retention procedure.

`glidelingo_app` receives `SELECT`/`INSERT` on the provider-actor and inbox tables plus
`SELECT`/`INSERT`/`UPDATE` on deliveries. It receives no `DELETE`, ownership, schema `CREATE`, or DDL
capability. Both the request process and `npm run worker:billing` use that bounded contract. Keep
`GLIDELINGO_BILLING_EVENT_INTAKE_ENABLED=false` everywhere until migration `005`, provider app/account
configuration, duplicate/out-of-order/lease/concurrency tests, worker deployment, metrics, alerting,
and recovery operations are reviewed. Enabling the flag without running the worker durably accepts
events but leaves deliveries pending.

## Disabled affiliate commission ledger

`007_affiliate_commission_ledger.sql` intentionally leaves migration number `006` available for the
Tutor lane. It must be inserted into the canonical production runner only after migration `006` is
merged, so production still applies the complete numeric sequence. The migration is additive, creates
no policy defaults, and grants the public runtime only `SELECT` on the minimized commission projection.
Accepted financial facts and commission entries are immutable. A future authenticated and reconciled
finance worker must receive a separate, narrowly scoped writer role in a later migration before this
ledger can consume Stripe marketplace facts; the public API identity cannot manufacture money.

Before `GLIDELINGO_AFFILIATE_COMMISSIONS_ENABLED=true`, an operator must create a draft policy and its
explicit product rules, review each rate in basis points, the half-up rounding rule, and effective
interval, then activate that immutable version. A future authenticated and reconciled Stripe boundary
must supply the actual settled currency and minor-unit amount; RevenueCat lifecycle events remain on
the no-side-effect reconciliation placeholder and cannot create ledger entries. Purchase facts lock
existing attribution before accruing; refund and refund-reversal facts append exact, chronological
negations of their named source entries. Contradictory event, transaction, amount, sequence, and
chronology facts fail for manual review instead of being treated as duplicate success. This slice does
not create Stripe networking, checkout, static provider pricing, commission policy values, balances,
transfer instructions, payouts, or provider mutations.
