#!/usr/bin/env bash
set -euo pipefail

expected_project="glidelingo-prod-50843312405"
project_id="${GLIDELINGO_GCP_PROJECT_ID:-${expected_project}}"
expected_project_number="738451432773"
region="${GLIDELINGO_GCP_REGION:-us-west1}"

if [[ "${project_id}" != "${expected_project}" ]]; then
  echo "Production bootstrap accepts only ${expected_project}." >&2
  exit 1
fi
for command in gcloud jq terraform; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required." >&2
    exit 1
  fi
done

active_project="$(gcloud config get-value project 2>/dev/null)"
if [[ "${active_project}" != "${project_id}" ]]; then
  echo "Active gcloud project must be exactly ${project_id}; found ${active_project:-unset}." >&2
  exit 1
fi

described_project="$(gcloud projects describe "${project_id}" --format='value(projectId)')"
if [[ "${described_project}" != "${project_id}" ]]; then
  echo "Unable to verify the isolated production project." >&2
  exit 1
fi
described_project_number="$(gcloud projects describe "${project_id}" --format='value(projectNumber)')"
committed_project_number="$(jq -r '.project_number' infra/gcp/environments/production/identity.json)"
if [[ "${described_project_number}" != "${expected_project_number}" \
  || "${committed_project_number}" != "${expected_project_number}" ]]; then
  echo "Resolved and committed production project numbers must both be ${expected_project_number}." >&2
  exit 1
fi

billing_account_name="$(gcloud billing projects describe "${project_id}" --format='value(billingAccountName)')"
billing_account_id="${billing_account_name#billingAccounts/}"
if [[ -z "${billing_account_id}" || "${billing_account_id}" == "${billing_account_name}" ]]; then
  echo "Production project must be linked to an accessible billing account." >&2
  exit 1
fi

terraform_version="$(terraform version -json | sed -n 's/.*"terraform_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
terraform_major="${terraform_version%%.*}"
terraform_minor_patch="${terraform_version#*.}"
terraform_minor="${terraform_minor_patch%%.*}"
if [[ -z "${terraform_version}" ]] || ((terraform_major < 1)) || ((terraform_major == 1 && terraform_minor < 11)); then
  echo "Terraform 1.11 or newer is required; found ${terraform_version:-unknown}." >&2
  exit 1
fi

gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  storage.googleapis.com \
  --project="${project_id}"

state_bucket="${project_id}-terraform-state"
if ! gcloud storage buckets describe "gs://${state_bucket}" --project="${project_id}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${state_bucket}" \
    --project="${project_id}" \
    --location="${region}" \
    --uniform-bucket-level-access \
    --public-access-prevention
  gcloud storage buckets update "gs://${state_bucket}" --versioning
fi

terraform -chdir=infra/gcp/environments/production init \
  -backend-config="bucket=${state_bucket}" \
  -reconfigure
terraform -chdir=infra/gcp/environments/production apply \
  -var="billing_account_id=${billing_account_id}" \
  -var="project_id=${project_id}" \
  -var="region=${region}"
