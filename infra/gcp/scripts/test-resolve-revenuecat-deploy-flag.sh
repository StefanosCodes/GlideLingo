#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly reader="${script_dir}/read-revenuecat-deploy-flag.sh"
readonly helper="${script_dir}/resolve-revenuecat-deploy-flag.sh"

expect_read() {
  local resource_kind="$1"
  local fixture="$2"
  local expected="$3"
  local actual
  actual="$("${reader}" "${resource_kind}" <<< "${fixture}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Expected ${resource_kind} fixture to read ${expected}; found ${actual}." >&2
    exit 1
  fi
}

expect_resolved() {
  local previous_flag="$1"
  local template_flag="$2"
  local expected="$3"
  local actual
  actual="$("${helper}" "${previous_flag}" "${template_flag}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Expected previous='${previous_flag}' template='${template_flag}' to resolve to ${expected}; found ${actual}." >&2
    exit 1
  fi
}

expect_rejected() {
  local previous_flag="$1"
  local template_flag="$2"
  if "${helper}" "${previous_flag}" "${template_flag}" >/dev/null 2>&1; then
    echo "Expected previous='${previous_flag}' template='${template_flag}' to be rejected." >&2
    exit 1
  fi
}

# The production reader distinguishes absent state from every present malformed state.
missing_service='{"spec":{"template":{"spec":{"containers":[{"env":[]}]}}}}'
missing_revision='{"spec":{"containers":[{"env":[]}]}}'
false_service='{"spec":{"template":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"false"}]}]}}}'
true_revision='{"spec":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"true"}]}]}}'
empty_literal_service='{"spec":{"template":{"spec":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":""}]}]}}}}'
duplicate_revision='{"spec":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"false"},{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"false"}]}]}}'
ref_shaped_service='{"spec":{"template":{"spec":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","valueFrom":{"secretKeyRef":{"name":"not-a-literal","key":"1"}}}]}]}}}}'
sentinel_literal_revision='{"spec":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":"__missing__"}]}]}}'
boolean_literal_revision='{"spec":{"containers":[{"env":[{"name":"GLIDELINGO_REVENUECAT_ENABLED","value":false}]}]}}'

expect_read service "${missing_service}" __missing__
expect_read revision "${missing_revision}" __missing__
expect_read service "${false_service}" false
expect_read revision "${true_revision}" true
expect_read service "${empty_literal_service}" __invalid__
expect_read revision "${duplicate_revision}" __invalid__
expect_read service "${ref_shaped_service}" __invalid__
expect_read revision "${sentinel_literal_revision}" __invalid__
expect_read revision "${boolean_literal_revision}" __invalid__

# Legacy pre-RevenueCat bootstrap and interrupted-bootstrap recovery.
expect_resolved __missing__ __missing__ false
expect_resolved __missing__ false false

# End-to-end regression cases use the production reader and resolver together.
expect_resolved \
  "$("${reader}" revision <<< "${missing_revision}")" \
  "$("${reader}" service <<< "${missing_service}")" \
  false
expect_resolved \
  "$("${reader}" revision <<< "${missing_revision}")" \
  "$("${reader}" service <<< "${false_service}")" \
  false

# Exact steady states.
expect_resolved false false false
expect_resolved true true true

# Every remaining empty/boolean pair conflicts with the activation boundary.
expect_rejected __missing__ true
expect_rejected false __missing__
expect_rejected false true
expect_rejected true __missing__
expect_rejected true false

# Present empty literals and every other malformed value are never legacy missing state.
expect_rejected "" ""
expect_rejected "" false
expect_rejected __missing__ ""
expect_rejected false ""
expect_rejected 1 false
expect_rejected false 1
expect_rejected FALSE false
expect_rejected false FALSE
expect_rejected __invalid__ false
expect_rejected false __invalid__
expect_rejected invalid invalid

echo "RevenueCat deploy-flag resolution matrix passed."
