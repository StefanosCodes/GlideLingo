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
- Cloud Build API support for the first in-project container build;
- a private Artifact Registry Docker repository;
- the Cloud Run runtime service account;
- a least-privilege GitHub deployment service account and OIDC trust restricted to the immutable
  `StefanosCodes/GlideLingo` repository/owner IDs and the `main` branch;
- a PostgreSQL 17 Enterprise development instance, database, and application user;
- a Secret Manager secret containing the SQLAlchemy Cloud SQL connection URL;
- a public, scale-to-zero Cloud Run service capped at three instances;
- a project-scoped monthly budget with default IAM-recipient alerts.

The database password is generated once as a sensitive Terraform value in the protected,
versioned GCS state backend. It is sent to the Cloud SQL user and Secret Manager through
write-only fields, which prevents extra plaintext copies in their resource state. The durable
generated value makes a partially failed apply retry-safe. Access to Terraform state therefore
grants access to this development credential and must remain limited to infrastructure operators.
Credential rotation is a reviewed infrastructure change: increment `database_password_epoch` in
`main.tf`, apply once, and verify readiness. The apply updates both consumers from the same durable
value and creates a Cloud Run revision pinned to the new concrete secret version.

## One-time bootstrap

Prerequisites:

- Google Cloud CLI authenticated as a project owner;
- Application Default Credentials (`gcloud auth application-default login`) when running outside
  Cloud Shell;
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
short-lived credentials through GitHub's OIDC token. The provider rejects tokens from feature
branches even if a branch copy of the workflow requests `id-token: write`.

## Repeat the complete setup

This repository is the source of truth for the development platform. No Codex plugin, browser
plugin, local Git hook, copied Cloud Shell session, or long-lived Google service-account key is
part of the deployment contract.

### Required tools and accounts

- a Google account allowed to administer `glidelingo-development` and its billing account;
- `gcloud`, authenticated with that Google account and configured for the exact project;
- Terraform 1.11 or newer for the one-time infrastructure bootstrap or later infrastructure
  changes;
- GitHub repository administration access for the three repository variables;
- GitHub Actions for normal verification and deployment.

Cloud Shell is optional. It is only a convenient place to run `gcloud` and Terraform. A local
machine with the same tools and permissions produces the same result.

### First-time development environment sequence

1. Create or select the `glidelingo-development` Google Cloud project and attach billing.
2. Authenticate `gcloud` and set its active project to `glidelingo-development`.
3. From the repository root, run `./infra/gcp/scripts/bootstrap-development.sh` and review the
   Terraform plan before approving it.
4. Read the `workload_identity_provider` and `deploy_service_account` Terraform outputs.
5. Add those values and `GCP_REGION` as GitHub repository variables using the names above.
6. Merge the deployment workflow into `main`.
7. Run `Deploy development API` once with `workflow_dispatch`, or merge a backend change into
   `main`. The workflow verifies, builds, pushes, deploys, and smoke-tests the API.
8. Configure development clients with the `api_url` Terraform output.

Interactive Google and GitHub sign-ins authorize the operator only. They are not application
dependencies and should never be copied into the repository or treated as reusable deployment
credentials.

### Normal backend release sequence

After the first-time setup, no console walkthrough or Terraform apply is required for an ordinary
backend release:

```text
merge a backend change to main
→ GitHub verifies the backend
→ GitHub obtains short-lived GCP credentials through OIDC
→ GitHub builds and pushes a commit-addressed container
→ Cloud Run deploys that immutable image
→ GitHub checks liveness and database readiness
```

Use Terraform only when changing infrastructure. Run the same bootstrap script to initialize the
backend and review the resulting plan; Terraform will reconcile the existing environment rather
than create a second copy.

### Boundaries for later integrations and environments

- Clerk, RevenueCat, and OpenAI are separate application-integration changes. Store their server
  secrets in Secret Manager and expose them only to the API components that require them.
- Do not add workers, queues, media storage, or additional services until a product feature needs
  them.
- The current bootstrap script intentionally refuses any project except
  `glidelingo-development`. Add separate Terraform environment directories, state buckets,
  projects, secrets, service accounts, budgets, and GitHub environments for staging and
  production. Do not repoint or share development state.
- Expo/EAS, App Store, Play Store, and signed Electron distribution remain independent client
  release lanes; GCP hosts the API and managed backend dependencies.

## Deploy the API

Run the `Deploy development API` workflow manually for the first deployment. Later, merges to
`main` that touch `backend/` or the workflow deploy automatically.

The workflow:

1. runs the canonical backend verification;
2. builds the production container;
3. pushes a commit-addressed image to Artifact Registry;
4. deploys that immutable image as a zero-traffic tagged candidate;
5. verifies the candidate's `/health/live` and `/health/ready` endpoints;
6. promotes the verified revision to 100% traffic and rolls back if the canonical smoke fails.

Manual rollback remains available:

```bash
gcloud run services update-traffic glidelingo-api \
  --project=glidelingo-development \
  --region=us-west1 \
  --to-revisions=PREVIOUS_REVISION=100
```

Use the `api_url` Terraform output as `EXPO_PUBLIC_API_BASE_URL` for development builds.

## Future integration contracts

- Clerk: add a Clerk secret and FastAPI token verification; do not make Cloud Run private.
- RevenueCat: add an authenticated, idempotent webhook endpoint and its signing secret.
- OpenAI tutor: add the OpenAI API key in Secret Manager and mount it only into the API.
- Workers and media: add Cloud Tasks and private Cloud Storage only when durable speech work
  exists.
