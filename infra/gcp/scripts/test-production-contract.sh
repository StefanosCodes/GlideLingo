#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
production="${root}/infra/gcp/environments/production"
activation="${production}/activation.auto.tfvars.json"
identity="${production}/identity.json"
state_reader="${root}/infra/gcp/scripts/read-production-deploy-state.sh"
workflow="${root}/.github/workflows/deploy-production-api.yml"

jq -e '
  (. | keys) == ["desktop_public_secret_versions", "revenuecat_enabled", "revenuecat_environment", "revenuecat_secret_set", "revenuecat_secret_versions"]
  and .revenuecat_enabled == false
  and .revenuecat_environment == "SANDBOX"
  and .revenuecat_secret_set == "sandbox"
  and all(.revenuecat_secret_versions[]; . == null)
  and all(.desktop_public_secret_versions[]; . == null)
' "${activation}" >/dev/null
jq -e '
  .project_id == "glidelingo-prod-50843312405"
  and .project_number == null
  and .workload_identity_pool_id == "github-actions"
  and .deploy_provider_id == "production-deploy"
  and .deploy_service_account_id == "glidelingo-prod-deployer"
  and .release_provider_id == "desktop-release"
  and .release_service_account_id == "glidelingo-desktop-releaser"
' "${identity}" >/dev/null

if grep -REn --include='*.tf' --include='*.json' '(secret_data[[:space:]]*=|"pk_(test|live)_|"rcb_(sb_)?|glidelingo-development)' "${production}"; then
  echo "Production Terraform contains a secret byte or development reference." >&2
  exit 1
fi
grep -Fq 'prefix = "glidelingo/production/platform"' "${production}/versions.tf"
grep -Fq 'prevent_destroy = true' "${production}/main.tf"
grep -Fq 'revenuecat_secret_set == "sandbox"' "${production}/main.tf"
grep -Fq 'revenuecat_secret_set == "production"' "${production}/main.tf"
grep -Fq 'desktop-release-signing' "${production}/main.tf"
grep -Fq 'production-staging' "${production}/main.tf"
grep -Fq 'jsondecode(file("${path.module}/identity.json"))' "${production}/main.tf"
if grep -REn --include='*.tf' --include='*.json' 'glidelingo-prod-50843312405-1|glidelingo-prod-\*' "${production}" \
  || grep -En 'glidelingo-prod-50843312405-1|glidelingo-prod-\*' \
    "${root}/infra/gcp/scripts/bootstrap-production.sh" \
    "${root}/infra/gcp/scripts/migrate-production-database.sh" \
    "${workflow}"; then
  echo "Production identity must not permit a fallback or wildcard project." >&2
  exit 1
fi
for secret_id in \
  glidelingo-desktop-macos-certificate-base64 \
  glidelingo-desktop-macos-certificate-password \
  glidelingo-desktop-apple-id \
  glidelingo-desktop-apple-app-specific-password \
  glidelingo-desktop-apple-team-id \
  glidelingo-desktop-clerk-publishable-key \
  glidelingo-revenuecat-sandbox-web-public-key \
  glidelingo-revenuecat-production-web-public-key; do
  grep -Fq "\"${secret_id}\"" "${production}/main.tf"
done
grep -Eq '^  workflow_dispatch:' "${workflow}"
grep -Fq 'environment: production-staging' "${workflow}"
grep -Eq 'environment: production$' "${workflow}"
grep -Fq 'merge-base --is-ancestor' "${workflow}"
grep -Fq 'read-production-deploy-state.sh' "${workflow}"
if grep -Fn '${{ secrets.' "${workflow}"; then
  echo "Production deployment must use WIF and must not read GitHub long-lived secrets." >&2
  exit 1
fi

fixture='{
  "metadata":{"generation":7},
  "spec":{"template":{"spec":{"containers":[{"env":[
    {"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"false"},
    {"name":"GLIDELINGO_REVENUECAT_ENVIRONMENT","value":"SANDBOX"}
  ]}]}}},
  "status":{"observedGeneration":7,"url":"https://api.example","traffic":[
    {"revisionName":"api-00001","percent":100},
    {"revisionName":"api-00002","percent":0,"tag":"candidate-deadbeef","url":"https://candidate.example"}
  ]}
}'
state="$("${state_reader}" candidate-deadbeef <<< "${fixture}")"
jq -e '.generation == "7" and .live_revision == "api-00001" and .candidate_revision == "api-00002"' <<< "${state}" >/dev/null
if "${state_reader}" candidate-deadbeef <<< "$(jq '.status.observedGeneration = 6' <<< "${fixture}")" >/dev/null 2>&1; then
  echo "Deploy-state reader accepted generation drift." >&2
  exit 1
fi
if "${state_reader}" candidate-deadbeef <<< "$(jq '.status.traffic[1].percent = 5' <<< "${fixture}")" >/dev/null 2>&1; then
  echo "Deploy-state reader accepted a nonzero candidate." >&2
  exit 1
fi

echo "Production isolation, activation, and deploy-state contracts passed."
