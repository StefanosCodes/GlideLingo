# Isolated production API platform

This root owns the desktop MVP's production API, database, deployment identities, and secret
containers. It deliberately shares no state, database, identity, or Secret Manager resource with
`glidelingo-development`. It does not provision the lesson tutor or store provider secret bytes.
The API explicitly allows CORS only from `https://desktop.glidelingo.com`.

## Bootstrap

The single approved project ID is `glidelingo-prod-50843312405`. There is no wildcard or fallback:
if the ID cannot be created, update the reviewed identity contract and every consumer before
proceeding. Create and link the project to billing, authenticate `gcloud` and Application Default
Credentials for that exact project, then run from the repository root:

```bash
./infra/gcp/scripts/bootstrap-production.sh
```

The script creates a separate, private, versioned state bucket and applies this root. Review the
plan before approving it. Terraform creates containers only for external credentials. Seed values
out of band, then select immutable positive versions in `activation.auto.tfvars.json`.

`identity.json` is the shared fail-closed identity contract for Terraform and the desktop release
validator. The pinned project number is `738451432773`. Terraform refuses an apply if the resolved
project ID, numeric project number, or immutable GitHub OIDC subject prefix differs from that
committed identity. An apply-blocking lifecycle precondition runs on required API enablement before
Terraform can create the production database or other paid resources; this is not an advisory
Terraform `check`.

Run the one-time database bootstrap only after the production instance exists:

```bash
GLIDELINGO_CONFIRM_PRODUCTION_MIGRATION=glidelingo-prod-50843312405 \
  ./infra/gcp/scripts/migrate-production-database.sh
```

The migration script creates a uniquely named short-lived Cloud SQL operator, starts a local
Cloud SQL Auth Proxy, and applies migrations 001–003 through a durable
`glidelingo_schema_migration` ledger. Each migration body and its checksum record commit in the same
transaction. An interruption therefore leaves no applied record and a rerun safely resumes; an
already-applied checksum is a no-op and a checksum mismatch fails closed. The retention schedule is
reconciled idempotently after schema migrations. The script verifies the expected tables and deletes
the operator on exit. Inspect and remove the named operator manually if cleanup reports a warning.

## GitHub environments

Create `production-staging` and `production`. Configure both with these non-secret environment
variables from Terraform outputs:

```text
GCP_PROJECT_ID
GCP_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
```

Require approval on `production`. The WIF provider accepts the exact repository identity only from
those two GitHub environments on `main`; service-account impersonation is bound to each exact
`google.subject`, never a repository-wide principal set, and no service-account key is stored in
GitHub. This repository customizes GitHub's OIDC subject with immutable owner and repository IDs,
so the accepted prefix is exactly
`repo:StefanosCodes@309610265/GlideLingo@1352030189`; the default name-only subject cannot
impersonate either service account. The deployment workflow accepts an exact 40-character commit reachable from `main`, stages a zero-traffic
candidate, proves health/auth and unchanged activation state, then pauses at `production` before
promotion. It rolls back to the recorded revision if canonical smoke tests fail.

If approval is rejected, a job is cancelled, or promotion fails, the final cleanup job inspects the
recorded candidate tag. It removes that tag only when it still points to the exact recorded
zero-traffic revision. An absent tag is already clean; an ambiguous tag or a tag moved to another
revision fails closed and requires operator inspection. Re-run the workflow only after the cleanup
job succeeds or the exact stale tag is reviewed manually.

For a hard workflow cancellation where GitHub cannot start the final cleanup job, authenticate
`gcloud` to the exact production project and run the recorded outputs explicitly:

```bash
./infra/gcp/scripts/cleanup-production-candidate.sh \
  candidate-0123456789abcdef0123456789abcdef01234567 \
  glidelingo-api-production-00001-abc
```

The operator script applies the same generation, zero-traffic, tag, and exact-revision checks. It
returns successfully when the tag is absent and refuses to remove a tag that moved to a different
revision.

Create `desktop-release-signing` for protected `desktop-v*` tags with the release WIF provider and
service-account outputs. Apple and versioned public build inputs are fetched from the production
project by exact Secret Manager version; GitHub should contain no long-lived signing credentials.

## Billing activation

The committed baseline is fail-closed: RevenueCat disabled, SANDBOX selected, and all version
selectors null. Prelaunch sandbox and live production use physically distinct Secret Manager
containers. A reviewed activation change must select all four API versions and both public desktop
build versions together. Terraform rejects partial configuration and rejects a SANDBOX/production
container mismatch. The runtime receives no RevenueCat Secret Manager accessor bindings while
billing is disabled. Every production Secret Manager container has Terraform destruction
protection.

Do not publish sandbox builds. To go live, seed the live Stripe-backed RevenueCat values in the
`production` containers, change the manifest to `PRODUCTION`/`production`, apply, deploy and verify
the API, then build and acceptance-test a new signed desktop release.
