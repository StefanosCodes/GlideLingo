#!/usr/bin/env bash
set -euo pipefail

readonly expected_project="glidelingo-development"
readonly region="${GLIDELINGO_GCP_REGION:-us-west1}"

command -v gcloud >/dev/null || {
  echo "Google Cloud CLI is required." >&2
  exit 1
}
command -v terraform >/dev/null || {
  echo "Terraform 1.11 or newer is required." >&2
  exit 1
}

active_project="$(gcloud config get-value project 2>/dev/null)"
if [[ "${active_project}" != "${expected_project}" ]]; then
  echo "Expected gcloud project ${expected_project}; found ${active_project:-unset}." >&2
  echo "Run: gcloud config set project ${expected_project}" >&2
  exit 1
fi

terraform_version="$(terraform version -json \
  | sed -n 's/.*"terraform_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
terraform_major="${terraform_version%%.*}"
terraform_minor_patch="${terraform_version#*.}"
terraform_minor="${terraform_minor_patch%%.*}"
if [[ -z "${terraform_version}" ]] \
  || (( terraform_major < 1 )) \
  || (( terraform_major == 1 && terraform_minor < 11 )); then
  echo "Terraform 1.11 or newer is required; found ${terraform_version:-unknown}." >&2
  exit 1
fi

gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  storage.googleapis.com \
  --project="${expected_project}"

state_bucket="${expected_project}-terraform-state"
if ! gcloud storage buckets describe "gs://${state_bucket}" \
  --project="${expected_project}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${state_bucket}" \
    --project="${expected_project}" \
    --location="${region}" \
    --uniform-bucket-level-access \
    --public-access-prevention
  gcloud storage buckets update "gs://${state_bucket}" --versioning
fi

terraform -chdir=infra/gcp/environments/development init \
  -backend-config="bucket=${state_bucket}" \
  -reconfigure
terraform -chdir=infra/gcp/environments/development apply \
  -var="project_id=${expected_project}" \
  -var="region=${region}"
