#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=activate-revenuecat-development.sh
source "${script_dir}/activate-revenuecat-development.sh"

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

echo "RevenueCat immutable secret-ref fixtures passed."
