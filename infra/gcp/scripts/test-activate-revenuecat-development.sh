#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=activate-revenuecat-development.sh
source "${script_dir}/activate-revenuecat-development.sh"

tfvars_file="${script_dir}/../environments/development/revenuecat.auto.tfvars.json"
workflow_file="${script_dir}/../../../.github/workflows/deploy-development-api.yml"
for workflow_assertion in \
  'expected_staged_generation="$((10#${initial_generation} + 1))"' \
  'resolved_revenuecat_flag="$(./infra/gcp/scripts/resolve-revenuecat-deploy-flag.sh' \
  'prepromotion_observed_generation' \
  'prepromotion_candidate_percent' \
  'prepromotion_revenuecat_raw'; do
  if ! grep -Fq -- "${workflow_assertion}" "${workflow_file}"; then
    echo "Normal deployment workflow is missing a required fail-closed assertion: ${workflow_assertion}" >&2
    exit 1
  fi
done

if ! jq -e '
  . as $root
  | ($root.revenuecat_secret_versions | [.[]]) as $versions
  | ($root | type) == "object"
    and ($root | keys) == ["revenuecat_enabled", "revenuecat_secret_versions"]
    and ($root.revenuecat_enabled | type) == "boolean"
    and ($root.revenuecat_secret_versions | type) == "object"
    and ($root.revenuecat_secret_versions | keys) == [
      "api_key",
      "pseudonym_key",
      "webhook_authorization",
      "webhook_signing_secret"
    ]
    and (
      all($versions[]; . == null)
      or all($versions[]; type == "string" and test("^[1-9][0-9]*$"))
    )
    and (
      ($root.revenuecat_enabled | not)
      or all($versions[]; type == "string" and test("^[1-9][0-9]*$"))
    )
' "${tfvars_file}" >/dev/null; then
  echo "RevenueCat auto tfvars must contain only the complete disabled/null or complete pinned-version contract." >&2
  exit 1
fi

valid_v1_fixture='{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "env": [
            {"name":"GLIDELINGO_REVENUECAT_API_KEY","valueFrom":{"secretKeyRef":{"name":"glidelingo-revenuecat-api-key","key":"1"}}},
            {"name":"GLIDELINGO_REVENUECAT_PSEUDONYM_KEY","valueFrom":{"secretKeyRef":{"name":"glidelingo-revenuecat-pseudonym-key","key":"2"}}},
            {"name":"GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION","valueFrom":{"secretKeyRef":{"name":"glidelingo-revenuecat-webhook-authorization","key":"3"}}},
            {"name":"GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET","valueFrom":{"secretKeyRef":{"name":"glidelingo-revenuecat-webhook-signing-secret","key":"4"}}}
          ]
        }]
      }
    }
  }
}'

expect_rejected() {
  local name="$1"
  local fixture="$2"
  if revenuecat_secret_refs service <<< "${fixture}" >/dev/null 2>&1; then
    echo "Expected ${name} fixture to be rejected." >&2
    exit 1
  fi
}

baseline_refs="$(revenuecat_secret_refs service <<< "${valid_v1_fixture}")"

fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/glidelingo-rc-fixtures.XXXXXX")"
null_config_file="${fixture_dir}/null.json"
pinned_config_file="${fixture_dir}/pinned.json"
mismatched_config_file="${fixture_dir}/mismatched.json"
enabled_config_file="${fixture_dir}/enabled.json"
webhook_authorization_fixture="${fixture_dir}/webhook-authorization"
webhook_signing_fixture="${fixture_dir}/webhook-signing"
webhook_payload_fixture="${fixture_dir}/webhook-payload"
webhook_headers_fixture="${fixture_dir}/webhook-headers"
cleanup_fixtures() {
  rm -f -- \
    "${null_config_file}" \
    "${pinned_config_file}" \
    "${mismatched_config_file}" \
    "${enabled_config_file}" \
    "${webhook_authorization_fixture}" \
    "${webhook_signing_fixture}" \
    "${webhook_payload_fixture}" \
    "${webhook_headers_fixture}"
  rmdir -- "${fixture_dir}" >/dev/null 2>&1 || true
}
trap cleanup_fixtures EXIT

jq '
  .revenuecat_enabled = false
  | .revenuecat_secret_versions[] = null
' "${tfvars_file}" > "${null_config_file}"
if desired_revenuecat_secret_refs "${null_config_file}" >/dev/null 2>&1; then
  echo "A null durable-config fixture must block activation." >&2
  exit 1
fi

jq '
  .revenuecat_enabled = false
  | .revenuecat_secret_versions = {
    api_key: "1",
    pseudonym_key: "2",
    webhook_authorization: "3",
    webhook_signing_secret: "4"
  }
' "${tfvars_file}" > "${pinned_config_file}"
pinned_desired_refs="$(desired_revenuecat_secret_refs "${pinned_config_file}")"
[[ "${pinned_desired_refs}" == "${baseline_refs}" ]]

jq '.revenuecat_secret_versions.api_key = "9"' \
  "${pinned_config_file}" > "${mismatched_config_file}"
mismatched_desired_refs="$(desired_revenuecat_secret_refs "${mismatched_config_file}")"
if [[ "${mismatched_desired_refs}" == "${baseline_refs}" ]]; then
  echo "A durable/local version mismatch must not equal the remote ref contract." >&2
  exit 1
fi

jq '.revenuecat_enabled = true' \
  "${pinned_config_file}" > "${enabled_config_file}"
if desired_revenuecat_secret_refs "${enabled_config_file}" >/dev/null 2>&1; then
  echo "Activation must require the durable desired-state flag to remain false." >&2
  exit 1
fi

is_exact_next_generation 41 42
if is_exact_next_generation 41 43 || is_exact_next_generation invalid 42; then
  echo "The exact-next-generation guard accepted drift or malformed input." >&2
  exit 1
fi

printf '%s' 'Bearer fixture-authorization' > "${webhook_authorization_fixture}"
printf '%s' 'fixture-signing-secret' > "${webhook_signing_fixture}"
printf '%s\n' '{"fixture":true}' > "${webhook_payload_fixture}"
: > "${webhook_headers_fixture}"
chmod 600 \
  "${webhook_authorization_fixture}" \
  "${webhook_signing_fixture}" \
  "${webhook_payload_fixture}" \
  "${webhook_headers_fixture}"
write_webhook_headers \
  "${webhook_authorization_fixture}" \
  "${webhook_signing_fixture}" \
  "${webhook_payload_fixture}" \
  1700000000 \
  "${webhook_headers_fixture}"
grep -Fxq 'Authorization: Bearer fixture-authorization' "${webhook_headers_fixture}"
grep -Fxq \
  'X-RevenueCat-Webhook-Signature: t=1700000000,v1=a3b3af2dc8943c2f43f7f5bef59bae7f2a4b262623ba5bc6886c2683bb645b57' \
  "${webhook_headers_fixture}"
grep -Fxq 'Content-Type: application/json' "${webhook_headers_fixture}"
headers_mode="$(stat -c '%a' "${webhook_headers_fixture}" 2>/dev/null \
  || stat -f '%Lp' "${webhook_headers_fixture}")"
[[ "${headers_mode}" == "600" ]]

valid_v2_fixture="$(jq '
  {
    spec: {
      template: {
        containers: [{
          env: [.spec.template.spec.containers[0].env[] |
            {
              name,
              valueSource: {
                secretKeyRef: {
                  secret: ("projects/glidelingo-development/secrets/" + .valueFrom.secretKeyRef.name),
                  version: .valueFrom.secretKeyRef.key
                }
              }
            }
          ]
        }]
      }
    }
  }
' <<< "${valid_v1_fixture}")"
[[ "$(revenuecat_secret_refs service <<< "${valid_v2_fixture}")" == "${baseline_refs}" ]]

valid_revision_fixture="$(jq '{spec: {containers: .spec.template.spec.containers}}' \
  <<< "${valid_v1_fixture}")"
[[ "$(revenuecat_secret_refs revision <<< "${valid_revision_fixture}")" == "${baseline_refs}" ]]

missing_fixture="$(jq '
  .spec.template.spec.containers[0].env |=
    map(select(.name != "GLIDELINGO_REVENUECAT_API_KEY"))
' <<< "${valid_v1_fixture}")"
expect_rejected missing "${missing_fixture}"

latest_fixture="$(jq '
  (.spec.template.spec.containers[0].env[] |
    select(.name == "GLIDELINGO_REVENUECAT_API_KEY") |
    .valueFrom.secretKeyRef.key) = "latest"
' <<< "${valid_v1_fixture}")"
expect_rejected latest "${latest_fixture}"

nonnumeric_fixture="$(jq '
  (.spec.template.spec.containers[0].env[] |
    select(.name == "GLIDELINGO_REVENUECAT_API_KEY") |
    .valueFrom.secretKeyRef.key) = "1a"
' <<< "${valid_v1_fixture}")"
expect_rejected nonnumeric "${nonnumeric_fixture}"

changed_fixture="$(jq '
  (.spec.template.spec.containers[0].env[] |
    select(.name == "GLIDELINGO_REVENUECAT_API_KEY") |
    .valueFrom.secretKeyRef.key) = "8"
' <<< "${valid_v1_fixture}")"
changed_refs="$(revenuecat_secret_refs service <<< "${changed_fixture}")"
if [[ "${changed_refs}" == "${baseline_refs}" ]]; then
  echo "Expected changed pinned version fixture to differ from the baseline contract." >&2
  exit 1
fi

wrong_secret_fixture="$(jq '
  (.spec.template.spec.containers[0].env[] |
    select(.name == "GLIDELINGO_REVENUECAT_API_KEY") |
    .valueFrom.secretKeyRef.name) = "some-other-secret"
' <<< "${valid_v1_fixture}")"
expect_rejected wrong-secret "${wrong_secret_fixture}"

echo "RevenueCat durable-config and immutable secret-ref fixtures passed."
