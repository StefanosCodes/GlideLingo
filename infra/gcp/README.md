# Google Cloud development platform

This directory owns the smallest GCP platform needed to deploy GlideLingo's existing
FastAPI/PostgreSQL walking skeleton. It intentionally does not provision authentication,
billing integrations, workers, media storage, web hosting, or production resources.

## Architecture

```text
Expo / Electron clients
        |
        | HTTPS
        v
public Cloud Run service
        |
        | Cloud SQL connector + bounded SQLAlchemy pool
        v
Cloud SQL for PostgreSQL 17

GitHub Actions --OIDC--> Workload Identity Federation --> API image deployment
```

The Cloud Run service is public at the network edge because installed clients cannot use
Google Cloud IAM. Feature authentication remains an application concern: Clerk tokens will
be verified by FastAPI when the authentication PR is integrated. Possession of the Cloud Run
URL is not authorization to learner data.

## What Terraform creates

- required Google Cloud APIs;
- a private Artifact Registry Docker repository;
- the Cloud Run runtime service account;
- a least-privilege GitHub deployment service account and OIDC trust restricted to
  `StefanosCodes/GlideLingo`;
- a PostgreSQL 17 Enterprise development instance, database, and application user;
- a Secret Manager secret containing the SQLAlchemy Cloud SQL connection URL;
- a public, scale-to-zero Cloud Run service capped at three instances;
- a project-scoped monthly budget with default IAM-recipient alerts.

The database password is generated as a Terraform ephemeral value. It is sent only to the
Cloud SQL user's write-only password field and Secret Manager's write-only secret field, so it
is not stored in configuration, plans, or state.

## One-time bootstrap

Prerequisites:

- Google Cloud CLI authenticated as a project owner;
- Terraform 1.11 or newer;
- billing enabled on `glidelingo-development`.

Run from the repository root:

```bash
./infra/gcp/scripts/bootstrap-development.sh
```

The script validates the exact project and its attached billing account, enables the
prerequisite bootstrap APIs, creates a versioned/private Terraform-state bucket if missing,
initializes the GCS backend, and applies the development configuration. Terraform will show
the complete resource plan and require explicit approval before it creates billable resources.

The default region is `us-west1`. Override it only on the first apply:

```bash
GLIDELINGO_GCP_REGION=us-west2 ./infra/gcp/scripts/bootstrap-development.sh
```

Changing a Cloud SQL region later requires replacement.

## Connect GitHub Actions

After the first apply, obtain the two non-secret output values:

```bash
terraform -chdir=infra/gcp/environments/development output -raw workload_identity_provider
terraform -chdir=infra/gcp/environments/development output -raw deploy_service_account
```

Create these GitHub repository variables:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
GCP_REGION
```

Set `GCP_REGION` to the region used during bootstrap, normally `us-west1`.

No Google service-account key is created or stored in GitHub. The deployment workflow obtains
short-lived credentials through GitHub's OIDC token.

## Deploy the API

Run the `Deploy development API` workflow manually for the first deployment. Later, merges to
`main` that touch `backend/` or the workflow deploy automatically.

The workflow:

1. runs the canonical backend verification;
2. builds the production container;
3. pushes a commit-addressed image to Artifact Registry;
4. deploys that immutable image to the existing Cloud Run service;
5. verifies `/health/live` and `/health/ready`.

Use the `api_url` Terraform output as `EXPO_PUBLIC_API_BASE_URL` for development builds.

## Future integration contracts

- Clerk: add a Clerk secret and FastAPI token verification; do not make Cloud Run private.
- RevenueCat: add an authenticated, idempotent webhook endpoint and its signing secret.
- OpenAI tutor: add the OpenAI API key in Secret Manager and mount it only into the API.
- Workers and media: add Cloud Tasks and private Cloud Storage only when durable speech work
  exists.
