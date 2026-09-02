#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
production="${root}/infra/gcp/environments/production"
activation="${production}/activation.auto.tfvars.json"
identity="${production}/identity.json"
state_reader="${root}/infra/gcp/scripts/read-production-deploy-state.sh"
cleanup_classifier="${root}/infra/gcp/scripts/classify-production-candidate-cleanup.sh"
cleanup_operator="${root}/infra/gcp/scripts/cleanup-production-candidate.sh"
workflow="${root}/.github/workflows/deploy-production-api.yml"
migration_workflow="${root}/.github/workflows/migrate-desktop-signing-secrets.yml"

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
  and .project_number == "738451432773"
  and .github_oidc_subject_prefix == "repo:StefanosCodes@309610265/GlideLingo@1352030189"
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
grep -Fq 'local.production_identity.project_number == tostring(data.google_project.current.number)' "${production}/main.tf"
grep -Fq 'precondition {' "${production}/main.tf"
if grep -Fq 'check "production_identity"' "${production}/main.tf"; then
  echo "Production identity mismatch must block apply; advisory Terraform checks are insufficient." >&2
  exit 1
fi
grep -Fq 'expected_project_number="738451432773"' "${root}/infra/gcp/scripts/bootstrap-production.sh"
if grep -Fq 'principalSet://iam.googleapis.com/' "${production}/main.tf"; then
  echo "Workload Identity impersonation must never use a broad principalSet binding." >&2
  exit 1
fi
grep -Fq '/subject/${each.value}' "${production}/main.tf"
grep -Fq 'github_oidc_subject_prefix = local.production_identity.github_oidc_subject_prefix' "${production}/main.tf"
grep -Fq "'\${local.github_oidc_subject_prefix}:environment:production-staging'" "${production}/main.tf"
grep -Fq "'\${local.github_oidc_subject_prefix}:environment:production'" "${production}/main.tf"
grep -Fq '"${local.github_oidc_subject_prefix}:environment:production-staging"' "${production}/main.tf"
grep -Fq '"${local.github_oidc_subject_prefix}:environment:production"' "${production}/main.tf"
grep -Fq "'\${local.github_oidc_subject_prefix}:environment:desktop-release-signing'" "${production}/main.tf"
grep -Fq 'subject/${local.github_oidc_subject_prefix}:environment:desktop-release-signing' "${production}/main.tf"
release_ref_contract="(assertion.ref == 'refs/heads/main' || assertion.ref.startsWith('refs/tags/desktop-v'))"
grep -Fq "${release_ref_contract}" "${production}/main.tf"
release_provider_condition="$(sed -n '/resource "google_iam_workload_identity_pool_provider" "release"/,/oidc {/p' "${production}/main.tf" | grep -F 'attribute_condition = ')"
[[ "${release_provider_condition}" == *"assertion.sub == '\${local.github_oidc_subject_prefix}:environment:desktop-release-signing' && ${release_ref_contract}"* ]]
for denied_release_ref in refs/heads/feature refs/heads/main-malicious refs/tags/v1.0.0 refs/tags/desktop-release; do
  if grep -Fq "${denied_release_ref}" <<< "${release_provider_condition}"; then
    echo "Release WIF condition unexpectedly permits ${denied_release_ref}." >&2
    exit 1
  fi
done
if grep -REn --include='*.tf' --include='*.json' 'repo:StefanosCodes/GlideLingo:environment:' "${production}"; then
  echo "Production WIF must use the repository's immutable-ID OIDC subject customization." >&2
  exit 1
fi
for secret_resource in database_url revenuecat desktop_public_config desktop_signing; do
  if ! sed -n "/resource \"google_secret_manager_secret\" \"${secret_resource}\"/,/^}/p" "${production}/main.tf" \
    | grep -Fq 'prevent_destroy = true'; then
    echo "Secret Manager container class ${secret_resource} lacks destruction protection." >&2
    exit 1
  fi
done
migration_binding="$(
  sed -n \
    '/resource "google_secret_manager_secret_iam_member" "releaser_signing_migration"/,/^}/p' \
    "${production}/main.tf"
)"
grep -Fq 'for_each = google_secret_manager_secret.desktop_signing' <<< "${migration_binding}"
grep -Fq 'role      = "roles/secretmanager.secretVersionAdder"' <<< "${migration_binding}"
grep -Fq 'member    = "serviceAccount:${google_service_account.desktop_releaser.email}"' <<< "${migration_binding}"
test -f "${migration_workflow}"
grep -Eq '^  workflow_dispatch:' "${migration_workflow}"
grep -Fq 'environment: desktop-release-signing' "${migration_workflow}"
grep -Fq 'test "${GITHUB_REF}" = "${EXPECTED_REF}"' "${migration_workflow}"
grep -Fq -- '--data-file=-' "${migration_workflow}"
grep -Fq -- '-legacy' "${migration_workflow}"
grep -Fq 'set +x' "${migration_workflow}"
expected_legacy_secrets="$(
  printf '%s\n' \
    secrets.APPLE_APP_SPECIFIC_PASSWORD \
    secrets.APPLE_ID \
    secrets.APPLE_TEAM_ID \
    secrets.MACOS_CERTIFICATE_BASE64 \
    secrets.MACOS_CERTIFICATE_PASSWORD
)"
actual_legacy_secrets="$(
  grep -Eo 'secrets\.[A-Z0-9_]+' "${migration_workflow}" |
    sort -u
)"
test "${actual_legacy_secrets}" = "${expected_legacy_secrets}"
grep -Fq 'for_each = var.revenuecat_enabled ? local.selected_revenuecat_secrets : {}' "${production}/main.tf"
grep -Fq 'name  = "GLIDELINGO_CORS_ORIGINS"' "${production}/main.tf"
grep -Fq 'value = jsonencode(["https://desktop.glidelingo.com"])' "${production}/main.tf"
if ! sed -n '/resource "google_sql_database" "application"/,/^}/p' "${production}/main.tf" \
  | grep -Fq 'prevent_destroy = true'; then
  echo "Production application database lacks destruction protection." >&2
  exit 1
fi
if grep -REn --include='*.tf' --include='*.json' 'glidelingo-prod-50843312405-1|glidelingo-prod-\*' "${production}" \
  || grep -En 'glidelingo-prod-50843312405-1|glidelingo-prod-\*' \
    "${root}/infra/gcp/scripts/bootstrap-production.sh" \
    "${root}/infra/gcp/scripts/migrate-production-database.sh" \
    "${workflow}"; then
  echo "Production identity must not permit a fallback or wildcard project." >&2
  exit 1
fi
migration_script="${root}/infra/gcp/scripts/migrate-production-database.sh"
grep -Fq 'data = @${user_request_file}' "${migration_script}"
grep -Fq 'chmod 600 "${user_request_file}" "${curl_config_file}"' "${migration_script}"
create_cleanup_line="$(grep -n -m1 '^operator_created=true$' "${migration_script}" | cut -d: -f1)"
create_request_line="$(grep -n -m1 '^curl --config ' "${migration_script}" | cut -d: -f1)"
test "${create_cleanup_line}" -lt "${create_request_line}"
if grep -Fq -- '--password="${operator_password}"' "${migration_script}" \
  || grep -Fq 'sql users set-password' "${migration_script}"; then
  echo "Production migration must keep temporary database credentials out of process arguments." >&2
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
grep -Fq 'classify-production-candidate-cleanup.sh' "${workflow}"
grep -Fq 'if: ${{ always() && needs.stage.result == '\''success'\'' }}' "${workflow}"
grep -Fq 'classify-production-candidate-cleanup.sh' "${cleanup_operator}"
grep -Fq -- '--remove-tags="${candidate_tag}"' "${cleanup_operator}"
grep -Fq 'TARGET_COMMIT_SHA: ${{ inputs.commit_sha }}' "${workflow}"
grep -Fq '[[ "${TARGET_COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]]' "${workflow}"
if grep -F '${{ inputs.commit_sha }}' "${workflow}" \
  | grep -Ev '^[[:space:]]+(ref|TARGET_COMMIT_SHA):[[:space:]]+\$\{\{ inputs\.commit_sha \}\}$'; then
  echo "Manual deploy input must enter shell steps only through TARGET_COMMIT_SHA." >&2
  exit 1
fi
if grep -F '${{ needs.stage.outputs.' "${workflow}" \
  | grep -Ev '^[[:space:]]+[A-Z][A-Z0-9_]*:[[:space:]]+\$\{\{ needs\.stage\.outputs\.[a-z_]+ \}\}$'; then
  echo "Stage outputs must enter promotion and cleanup shells only through named environment variables." >&2
  exit 1
fi
grep -Fq 'EXPECTED_CORS_ORIGINS: ${{ needs.stage.outputs.cors_origins }}' "${workflow}"
grep -Fq 'test "$(jq -r .cors_origins <<< "${current_state}")" = "${EXPECTED_CORS_ORIGINS}"' "${workflow}"
cors_round_trip_fixture='["https://desktop.glidelingo.com"]'
shell_sentinel='$(printf should-not-execute)'
round_trip="$(
  EXPECTED_CORS_ORIGINS="${cors_round_trip_fixture}" \
  CANDIDATE_TAG="${shell_sentinel}" \
    bash -c 'printf "%s\n%s" "${EXPECTED_CORS_ORIGINS}" "${CANDIDATE_TAG}"'
)"
expected_round_trip="$(printf '%s\n%s' "${cors_round_trip_fixture}" "${shell_sentinel}")"
[[ "${round_trip}" == "${expected_round_trip}" ]]
if grep -Fn '${{ secrets.' "${workflow}"; then
  echo "Production deployment must use WIF and must not read GitHub long-lived secrets." >&2
  exit 1
fi

fixture='{
  "metadata":{"generation":7},
  "spec":{"template":{"spec":{"containers":[{"env":[
    {"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"false"},
    {"name":"GLIDELINGO_REVENUECAT_ENVIRONMENT","value":"SANDBOX"},
    {"name":"GLIDELINGO_CORS_ORIGINS","value":"[\"https://desktop.glidelingo.com\"]"}
  ]}]}}},
  "status":{"observedGeneration":7,"url":"https://api.example","traffic":[
    {"revisionName":"api-00001","percent":100},
    {"revisionName":"api-00002","percent":0,"tag":"candidate-deadbeef","url":"https://candidate.example"}
  ]}
}'
state="$("${state_reader}" candidate-deadbeef <<< "${fixture}")"
jq -e '.generation == "7" and .live_revision == "api-00001" and .candidate_revision == "api-00002"' <<< "${state}" >/dev/null
if "${state_reader}" candidate-deadbeef <<< "$(jq '(.spec.template.spec.containers[0].env[] | select(.name == "GLIDELINGO_CORS_ORIGINS") | .value) = "[\\\"https://evil.example\\\"]"' <<< "${fixture}")" >/dev/null 2>&1; then
  echo "Deploy-state reader accepted a noncanonical production CORS origin." >&2
  exit 1
fi
if "${state_reader}" candidate-deadbeef <<< "$(jq '.status.observedGeneration = 6' <<< "${fixture}")" >/dev/null 2>&1; then
  echo "Deploy-state reader accepted generation drift." >&2
  exit 1
fi

cleanup_tag="candidate-0123456789abcdef0123456789abcdef01234567"
cleanup_fixture="$(jq --arg tag "${cleanup_tag}" '.status.traffic[1].tag = $tag' <<< "${fixture}")"
[[ "$("${cleanup_classifier}" "${cleanup_tag}" api-00002 <<< "${cleanup_fixture}")" == "remove" ]]
[[ "$("${cleanup_classifier}" "${cleanup_tag}" api-00002 <<< "$(jq '.status.traffic |= map(select(.tag == null))' <<< "${cleanup_fixture}")")" == "absent" ]]
if "${cleanup_classifier}" "${cleanup_tag}" api-99999 <<< "${cleanup_fixture}" >/dev/null 2>&1; then
  echo "Cleanup classifier would delete a tag attached to a different revision." >&2
  exit 1
fi
if "${state_reader}" candidate-deadbeef <<< "$(jq '.status.traffic[1].percent = 5' <<< "${fixture}")" >/dev/null 2>&1; then
  echo "Deploy-state reader accepted a nonzero candidate." >&2
  exit 1
fi

echo "Production isolation, activation, and deploy-state contracts passed."
