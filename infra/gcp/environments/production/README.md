# Isolated production API platform

This root owns the desktop MVP's production API, database, deployment identities, and secret
containers. It deliberately shares no state, database, identity, or Secret Manager resource with
`glidelingo-development`. It does not provision the lesson tutor or store provider secret bytes.

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
validator. Its project number intentionally starts as `null`. After project creation, copy the
numeric `project_number` from Terraform's `production_contract` output into that file through a
reviewed PR before any release can authenticate. Release validation must reject a null or mismatched
number.

Run the one-time database bootstrap only after the production instance exists:

```bash
GLIDELINGO_CONFIRM_PRODUCTION_MIGRATION=glidelingo-prod-50843312405 \
  ./infra/gcp/scripts/migrate-production-database.sh
```

The migration script creates a uniquely named short-lived Cloud SQL operator, starts a local
Cloud SQL Auth Proxy, applies migrations 001–003 and the retention schedule, verifies the expected
tables, and deletes the operator on exit. Inspect and remove the named operator manually if cleanup
reports a warning.

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
those two GitHub environments on `main`; no service-account key is stored in GitHub. The deployment
workflow accepts an exact 40-character commit reachable from `main`, stages a zero-traffic
candidate, proves health/auth and unchanged activation state, then pauses at `production` before
promotion. It rolls back to the recorded revision if canonical smoke tests fail.

Create `desktop-release-signing` for protected `desktop-v*` tags with the release WIF provider and
service-account outputs. Apple and versioned public build inputs are fetched from the production
project by exact Secret Manager version; GitHub should contain no long-lived signing credentials.

## Billing activation

The committed baseline is fail-closed: RevenueCat disabled, SANDBOX selected, and all version
selectors null. Prelaunch sandbox and live production use physically distinct Secret Manager
containers. A reviewed activation change must select all four API versions and both public desktop
build versions together. Terraform rejects partial configuration and rejects a SANDBOX/production
container mismatch.

Do not publish sandbox builds. To go live, seed the live Stripe-backed RevenueCat values in the
`production` containers, change the manifest to `PRODUCTION`/`production`, apply, deploy and verify
the API, then build and acceptance-test a new signed desktop release.
