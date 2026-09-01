# Google Cloud development platform

This directory owns the smallest GCP platform needed to deploy GlideLingo's public
FastAPI/PostgreSQL API and dormant IAM-private tutor. It configures Clerk verification inputs and
tutor and RevenueCat configuration containers. RevenueCat authorization remains disabled until its
explicit activation gates pass. This environment intentionally does not provision workers, media
storage, web hosting, or production resources.

## Architecture

```text
Expo / Electron clients
        |
        | HTTPS
        v
public Cloud Run service
        |-- Google-signed ID token --> IAM-private tutor Cloud Run --> OpenAI
        |
        | Cloud SQL connector + bounded SQLAlchemy pool
        v
Cloud SQL for PostgreSQL 17

GitHub Actions --OIDC--> Workload Identity Federation --> API image deployment
```

The public Cloud Run service remains public at the network edge because installed clients cannot use
Google Cloud IAM. FastAPI verifies Clerk session tokens for application routes. The tutor Cloud Run
service separately requires Google IAM and names only the API runtime as invoker. Possession of
either URL is not authorization to learner data.

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
- an IAM-private, scale-to-zero tutor service whose only invoker is the API runtime identity;
- distinct API and tutor runtime identities plus development-only tutor and RevenueCat configuration
  containers (Terraform creates no provider-supplied secret values or versions);
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

The Clerk values are non-secret configuration pinned to the development instance through validated
Terraform defaults. Rotate the Terraform values and deployment-workflow values together, and inspect
the Cloud Run environment diff before approval. Do not put local `.env` contents in committed tfvars.

## RevenueCat authorization activation gates

`revenuecat_enabled` defaults to `false`. Terraform always creates four regional Secret Manager
containers for the app public SDK key, actor pseudonym key, webhook Authorization value, and webhook
HMAC signing secret. It never creates their values. The API runtime receives accessor access only to
those four containers, and Cloud Run mounts only the immutable versions named in
`revenuecat_secret_versions`; `latest` is never used.

Keep the integration disabled while staging all four versions. The `api_key` value is the least-
privileged app public SDK key accepted by RevenueCat's read-only v1 Customer Info endpoint. Use a
`test_...` key only when both client and server exercise RevenueCat Test Store. For real desktop
Stripe-sandbox acceptance, use the Web public SDK key from the dedicated RevenueCat Billing
configuration connected to that Stripe sandbox (currently expected to start with `rcb_...`), and
configure the renderer with the exact same key. Production requires a separate Billing configuration
connected to live Stripe and its matching Web public SDK key. Never supply a project-wide `sk_...`
key. Add the other three high-entropy values out of band so they never enter Terraform state,
committed tfvars, shell history, or CI logs.

Before changing `revenuecat_enabled` to `true`, independently verify:

1. `backend/migrations/002_revenuecat_entitlements.sql` is applied and the runtime grants are exact.
2. Daily bounded cleanup from `backend/migrations/maintenance_revenuecat_webhooks.sql` runs under a
   separate delete-capable maintenance identity.
3. RevenueCat has a sandbox-only webhook pointing to
   `https://glidelingo-api-50843312405.us-west1.run.app/v1/billing/revenuecat/webhook`, with the exact
   Authorization value and HMAC signing enabled; the one-time signing secret is stored as its own
   immutable version.
4. `revenuecat_secret_versions` names all four exact positive version numbers and Terraform applies
   them while the flag remains false.
5. A signed dashboard test webhook reaches the disabled deployment as expected, then a reviewed
   enabled candidate passes webhook, reconcile, entitlement, and negative-auth smoke checks before
   promotion.

Terraform refuses an enabled configuration unless every version is pinned. For the development
rollout, `revenuecat_environment` stays `SANDBOX`; production requires a separate future environment,
project, keys, secrets, and state.

### Activate RevenueCat in development

Traffic and billing-state transitions are deliberately separated from Terraform. Terraform ignores
the API service's container image and `traffic` fields; GitHub Actions owns normal image promotion,
and the interactive activation script owns the one-time disabled-to-enabled RevenueCat transition.
An ordinary API deployment reads `GLIDELINGO_REVENUECAT_ENABLED` from the exact revision currently
serving 100% and from its zero-traffic candidate. It refuses promotion when those normalized states
differ and directs the operator to the activation script. Therefore a routine image release cannot
silently bypass the positive billing gate.

Before running the script, keep the 100%-serving revision and current service template explicitly
disabled and complete all five gates above. In particular, retain operator evidence from a positive
RevenueCat dashboard test webhook signed with the configured sandbox HMAC secret and accepted at the
documented webhook URL. The activation script does not fetch, generate, display, or test provider
webhook credentials; that signed dashboard result is a separate prerequisite. Also confirm that the
Clerk user used for the smoke test currently has an active `pro` entitlement in the `SANDBOX`
RevenueCat environment.

Authenticate `gcloud`, select the exact development project, obtain a freshly issued short-lived
Clerk session token for that test user, and run from an interactive terminal at the repository root:

```bash
gcloud config set project glidelingo-development
./infra/gcp/scripts/activate-revenuecat-development.sh
```

The script is intentionally fixed to `glidelingo-development`, `us-west1`, and `glidelingo-api`. It
records the sole 100%-serving disabled revision, stages only
`GLIDELINGO_REVENUECAT_ENABLED=true` on a tagged zero-traffic candidate, and keeps the Clerk token in
a mode-600 temporary curl configuration that is deleted on exit. It proves candidate liveness and
readiness, invalid-token rejection, authenticated reconciliation, and the active sandbox Pro
contract. Immediately before promotion it rejects any service generation, observed generation,
traffic, tag, revision, URL, or RevenueCat-flag drift. After promoting the exact candidate, it repeats
canonical health and authenticated entitlement checks.

Any failure before promotion resets the service template to
`GLIDELINGO_REVENUECAT_ENABLED=false`, verifies that the recorded previous revision still serves 100%,
and removes the candidate tag. A post-promotion smoke failure routes 100% back to that exact previous
revision, resets the template disabled, and removes the tag. If an automatic recovery command reports
a warning, immediately inspect Cloud Run and manually route the recorded previous revision to 100%
before making another deployment. The script never changes secret versions and never performs a
Terraform apply.

After successful promotion, reconcile the durable desired state. Run a Terraform plan with
`revenuecat_enabled=true`, `revenuecat_environment="SANDBOX"`, and the same four exact positive
`revenuecat_secret_versions` already mounted on the candidate. Because this repository does not yet
define a durable non-secret tfvars contract for those site-specific values, the activation script
prints this required follow-up but does not construct or run the command. Review the plan and require
that it proposes no Cloud Run template or traffic change before applying it. Do not leave the live
enabled service dependent on console or script drift from Terraform's declared billing state.

## Private tutor activation gates

Both `lesson_tutor_enabled` and `private_lesson_tutor_enabled` default to `false`. Leave them false
until all of the following are independently verified:

1. Apply `backend/migrations/001_lesson_tutor_guard.sql` transactionally and schedule the bounded
   seven-day retention command from `backend/migrations/README.md` with a maintenance-only role.
2. Add a random development pseudonym-key version and a development OpenAI-key version to the two
   Terraform-created Secret Manager containers. Pass exact immutable version numbers to Terraform;
   never use `latest` and never place secret bytes in Terraform variables, state, GitHub, or logs.
3. Configure and verify Clerk issuer, JWKS URL, authorized parties, and optional audience on the
   public API. The current live API fails closed with `503` until this is applied.
4. Deploy and smoke the private image while disabled. Confirm unauthenticated direct invocation is
   rejected by Cloud Run IAM and the API runtime identity is the only `roles/run.invoker` member.
5. Implement and verify server-owned RevenueCat entitlement authorization before paid access is
   enabled. Client `isPro` state is never authorization.
6. Run negative auth, idempotency, concurrency, timeout, container, Terraform, and live-agent smoke
   checks. Establish deterministic graders and stable pass thresholds for the authored behavior cases;
   then enable the private flag before the public flag in one reviewed development rollout.

The public API sends only a tutor-scoped HMAC pseudonym, a server-generated turn reference, bounded
lesson/page fields, current message, and at most eight history messages. It never sends the Clerk
token or raw subject, profile fields, RevenueCat data, entitlement state, or public conversation ID.
The private service disables sensitive model/tool logging and tracing, uses `store=false`, and uses
only the pseudonym as OpenAI's safety identifier.

This directory is development-only. Production must be a separate future GCP project and Terraform
state with separate service accounts, deploy identity, secret containers and versions, Clerk and
RevenueCat configuration, budget, review, and approvals. A separate production provider key is
recommended; temporarily seeding the distinct production secret version with the same provider value
is allowed, but production must never copy or reference the development secret resource or version.

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

- Clerk JWT verification is configured on Cloud Run with the public development issuer, JWKS URL,
  and exact authorized-party origins. These values are not secrets.
- RevenueCat server authorization is implemented but remains a disabled activation gate. Never trust
  the client entitlement snapshot; mount exact Secret Manager versions only after the migration,
  webhook, retention, and sandbox evidence exist.
- RevenueCat webhook credentials and OpenAI server credentials belong in Secret Manager and must be
  exposed only to the API components that require them. The RevenueCat app SDK key is public but is
  mounted through the same version-pinned server configuration contract.
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
5. refuses promotion if the exact live and candidate revisions have different normalized RevenueCat
   activation states;
6. verifies the candidate's `/health/live` and `/health/ready` endpoints;
7. promotes the verified revision to 100% traffic and rolls back if the canonical smoke fails.

Manual rollback remains available:

```bash
gcloud run services update-traffic glidelingo-api \
  --project=glidelingo-development \
  --region=us-west1 \
  --to-revisions=PREVIOUS_REVISION=100
```

Use the `api_url` Terraform output as `EXPO_PUBLIC_API_BASE_URL` for development builds.

## Integration contracts

- Clerk: FastAPI verifies standard Clerk session tokens from the public JWKS endpoint; no Clerk
  secret key is required for this verifier. Keep Cloud Run publicly invokable so the application
  can reach it, and enforce authentication inside FastAPI on protected routes.
- RevenueCat: FastAPI exposes an authenticated, HMAC-signed, idempotent webhook and server-owned
  entitlement reconciliation. Terraform keeps it disabled and refuses partial secret-version input.
- OpenAI tutor activation: add an immutable version to the tutor-only development secret container,
  deploy an enabled private revision, and satisfy every activation gate above.
- Workers and media: add Cloud Tasks and private Cloud Storage only when durable speech work
  exists.
