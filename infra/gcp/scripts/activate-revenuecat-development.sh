#!/usr/bin/env bash
set -euo pipefail

readonly expected_project="glidelingo-development"
readonly expected_region="us-west1"
readonly expected_service="glidelingo-api"
readonly revenuecat_flag="GLIDELINGO_REVENUECAT_ENABLED"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir
readonly revenuecat_tfvars_file="${script_dir}/../environments/development/revenuecat.auto.tfvars.json"
readonly revenuecat_secret_contract='{
  "GLIDELINGO_REVENUECAT_API_KEY": "glidelingo-revenuecat-api-key",
  "GLIDELINGO_REVENUECAT_PSEUDONYM_KEY": "glidelingo-revenuecat-pseudonym-key",
  "GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION": "glidelingo-revenuecat-webhook-authorization",
  "GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET": "glidelingo-revenuecat-webhook-signing-secret"
}'
readonly revenuecat_selector_contract='{
  "api_key": "GLIDELINGO_REVENUECAT_API_KEY",
  "pseudonym_key": "GLIDELINGO_REVENUECAT_PSEUDONYM_KEY",
  "webhook_authorization": "GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION",
  "webhook_signing_secret": "GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET"
}'

candidate_tag=""
candidate_revision=""
previous_revision=""
work_dir=""
curl_config=""
response_file=""
webhook_authorization_file=""
webhook_signing_secret_file=""
webhook_payload_file=""
webhook_headers_file=""
webhook_signature_timestamp=""
staged=false
traffic_promoted=false
activation_complete=false

die() {
  echo "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required."
}

describe_service() {
  gcloud run services describe "${expected_service}" \
    --project="${expected_project}" \
    --region="${expected_region}" \
    --format=json
}

describe_revision() {
  local revision="$1"
  gcloud run revisions describe "${revision}" \
    --project="${expected_project}" \
    --region="${expected_region}" \
    --format=json
}

template_revenuecat_flag() {
  jq -r --arg name "${revenuecat_flag}" \
    '[(.spec.template.spec.containers[0].env // .spec.template.containers[0].env // [])[]? | select(.name == $name)] | if length == 1 then (.[0].value // "") else "" end'
}

revision_revenuecat_flag() {
  jq -r --arg name "${revenuecat_flag}" \
    '[(.spec.containers[0].env // [])[]? | select(.name == $name)] | if length == 1 then (.[0].value // "") else "" end'
}

revenuecat_secret_refs() {
  local resource_kind="$1"
  jq -cS --arg resource_kind "${resource_kind}" --argjson expected "${revenuecat_secret_contract}" '
    def supported_refs:
      [
        if .valueFrom.secretKeyRef? != null then
          {
            secret: (.valueFrom.secretKeyRef.name // ""),
            version: (.valueFrom.secretKeyRef.key // "" | tostring)
          }
        else empty end,
        if .valueSource.secretKeyRef? != null then
          {
            secret: (.valueSource.secretKeyRef.secret // ""),
            version: (.valueSource.secretKeyRef.version // "" | tostring)
          }
        else empty end
      ];
    (if $resource_kind == "service" then
       (.spec.template.spec.containers[0].env // .spec.template.containers[0].env // null)
     elif $resource_kind == "revision" then
       (.spec.containers[0].env // null)
     else
       error("unsupported resource kind")
     end) as $env
    | if ($env | type) != "array" then error("missing container environment") else . end
    | reduce ($expected | keys[]) as $name
        ({};
          [$env[] | select(.name == $name)] as $matches
          | if ($matches | length) != 1 then error("missing or duplicate required secret ref") else . end
          | $matches[0] as $entry
          | if $entry.value? != null then error("required environment entry contains a literal value") else . end
          | ($entry | supported_refs) as $refs
          | if ($refs | length) != 1 then error("required environment entry has no single supported secret ref") else . end
          | $refs[0] as $ref
          | ($ref.secret | tostring | split("/")[-1]) as $secret_id
          | if $secret_id != $expected[$name] then error("required environment entry references the wrong secret") else . end
          | if ($ref.version | test("^[1-9][0-9]*$") | not) then error("secret version is not an immutable positive number") else . end
          | .[$name] = {secret: $secret_id, version: $ref.version}
        )
  '
}

desired_revenuecat_secret_refs() {
  local config_file="${1:-${revenuecat_tfvars_file}}"
  jq -cS \
    --argjson expected "${revenuecat_secret_contract}" \
    --argjson selectors "${revenuecat_selector_contract}" '
      if (type != "object" or keys != ["revenuecat_enabled", "revenuecat_secret_versions"]) then
        error("unexpected desired-state shape")
      elif .revenuecat_enabled != false then
        error("activation requires durable disabled state")
      elif (.revenuecat_secret_versions | type) != "object"
        or (.revenuecat_secret_versions | keys) != ($selectors | keys) then
        error("unexpected secret selector shape")
      else . end
      | .revenuecat_secret_versions as $versions
      | reduce ($selectors | keys[]) as $selector
          ({};
            ($versions[$selector]) as $version
            | if (($version | type) != "string" or ($version | test("^[1-9][0-9]*$") | not)) then
                error("activation requires every immutable version")
              else . end
            | ($selectors[$selector]) as $env_name
            | .[$env_name] = {secret: $expected[$env_name], version: $version}
          )
    ' "${config_file}"
}

is_exact_next_generation() {
  local initial="$1"
  local next="$2"
  [[ "${initial}" =~ ^[1-9][0-9]*$ && "${next}" =~ ^[1-9][0-9]*$ ]] || return 1
  (( 10#${next} == 10#${initial} + 1 ))
}

one_hundred_percent_revision() {
  jq -r \
    '[.status.traffic[]? | select((.percent // 0) == 100)] | if length == 1 then (.[0].revisionName // "") else "" end'
}

remove_candidate_tag() {
  if [[ -n "${candidate_tag}" ]]; then
    gcloud run services update-traffic "${expected_service}" \
      --project="${expected_project}" \
      --region="${expected_region}" \
      --remove-tags="${candidate_tag}" \
      --quiet >/dev/null 2>&1 || {
        echo "Warning: could not remove candidate tag ${candidate_tag}; remove it manually." >&2
        return 1
      }
  fi
}

verify_previous_still_serving() {
  local current_json current_revision
  current_json="$(describe_service)" || return 1
  current_revision="$(one_hundred_percent_revision <<< "${current_json}")"
  if [[ "${current_revision}" != "${previous_revision}" ]]; then
    echo "Expected ${previous_revision} to remain the sole 100%-serving revision; found ${current_revision:-none}." >&2
    return 1
  fi
}

reset_disabled_template() {
  echo "Restoring the service template to RevenueCat disabled." >&2
  if ! gcloud run services update "${expected_service}" \
    --project="${expected_project}" \
    --region="${expected_region}" \
    --update-env-vars="${revenuecat_flag}=false" \
    --no-traffic \
    --quiet >/dev/null; then
    echo "Warning: automatic template reset failed. Keep ${previous_revision} at 100% and reset ${revenuecat_flag}=false manually." >&2
    return 1
  fi
  verify_previous_still_serving || {
    echo "Warning: inspect Cloud Run traffic immediately; the disabled template reset did not prove that ${previous_revision} still serves 100%." >&2
    return 1
  }
}

rollback_previous_revision() {
  echo "Rolling traffic back to ${previous_revision}." >&2
  if ! gcloud run services update-traffic "${expected_service}" \
    --project="${expected_project}" \
    --region="${expected_region}" \
    --to-revisions="${previous_revision}=100" \
    --quiet >/dev/null; then
    echo "Warning: automatic rollback failed. Route 100% traffic to ${previous_revision} immediately." >&2
    return 1
  fi
  verify_previous_still_serving
}

cleanup() {
  local exit_status=$?
  trap - EXIT

  if [[ "${staged}" == "true" && "${activation_complete}" != "true" ]]; then
    if [[ "${traffic_promoted}" == "true" ]]; then
      rollback_previous_revision || true
    fi
    reset_disabled_template || true
  fi

  remove_candidate_tag || true

  if [[ -n "${curl_config}" ]]; then
    rm -f -- "${curl_config}"
  fi
  if [[ -n "${response_file}" ]]; then
    rm -f -- "${response_file}"
  fi
  if [[ -n "${webhook_headers_file}" ]]; then
    rm -f -- "${webhook_headers_file}"
  fi
  if [[ -n "${webhook_payload_file}" ]]; then
    rm -f -- "${webhook_payload_file}"
  fi
  if [[ -n "${webhook_authorization_file}" ]]; then
    rm -f -- "${webhook_authorization_file}"
  fi
  if [[ -n "${webhook_signing_secret_file}" ]]; then
    rm -f -- "${webhook_signing_secret_file}"
  fi
  if [[ -n "${work_dir}" ]]; then
    rmdir -- "${work_dir}" >/dev/null 2>&1 || true
  fi

  exit "${exit_status}"
}

health_smoke() {
  local base_url="$1"
  local path
  for path in /health/live /health/ready; do
    if ! curl --silent --show-error --fail \
      --connect-timeout 5 \
      --max-time 20 \
      --retry 3 \
      --retry-all-errors \
      --retry-delay 2 \
      --output /dev/null \
      "${base_url}${path}"; then
      echo "Health smoke failed for ${path}." >&2
      return 1
    fi
  done
}

invalid_auth_smoke() {
  local base_url="$1"
  local status
  status="$(curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 20 \
    --retry 2 \
    --retry-all-errors \
    --retry-delay 2 \
    --output /dev/null \
    --header 'Authorization: Bearer invalid-revenuecat-activation-token' \
    --write-out '%{http_code}' \
    "${base_url}/v1/billing/entitlements/pro")" || return 1
  if [[ "${status}" != "401" ]]; then
    echo "Expected invalid billing authentication to return 401; received ${status}." >&2
    return 1
  fi
}

authenticated_entitlement_smoke() {
  local base_url="$1"
  local method="$2"
  local path="$3"
  local status

  : > "${response_file}"
  status="$(curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 20 \
    --retry 2 \
    --retry-all-errors \
    --retry-delay 2 \
    --config "${curl_config}" \
    --request "${method}" \
    --output "${response_file}" \
    --write-out '%{http_code}' \
    "${base_url}${path}")" || {
      echo "Authenticated ${method} ${path} request failed." >&2
      return 1
    }
  if [[ "${status}" != "200" ]]; then
    echo "Authenticated ${method} ${path} returned ${status}; expected 200. Response body was withheld." >&2
    return 1
  fi
  if ! jq -e \
    '.entitlement_id == "pro" and .environment == "SANDBOX" and .state == "active" and .is_pro == true' \
    "${response_file}" >/dev/null; then
    echo "Authenticated ${method} ${path} did not return the required active SANDBOX Pro contract. Response body was withheld." >&2
    return 1
  fi
}

write_webhook_headers() {
  local authorization_file="$1"
  local signing_secret_file="$2"
  local payload_file="$3"
  local timestamp="$4"
  local headers_file="$5"
  python3 - \
    "${authorization_file}" \
    "${signing_secret_file}" \
    "${payload_file}" \
    "${timestamp}" \
    "${headers_file}" <<'PYTHON'
import hashlib
import hmac
import os
import sys
from pathlib import Path

authorization = Path(sys.argv[1]).read_bytes()
signing_secret = Path(sys.argv[2]).read_bytes()
raw_body = Path(sys.argv[3]).read_bytes()
timestamp = sys.argv[4].encode("ascii")
headers_path = Path(sys.argv[5])

if not authorization or any(character in authorization for character in (b"\r", b"\n", b"\0")):
    raise SystemExit("Webhook Authorization secret is not safe for an HTTP header.")
if not signing_secret or b"\0" in signing_secret:
    raise SystemExit("Webhook signing secret is empty or invalid.")

signature = hmac.new(
    signing_secret,
    timestamp + b"." + raw_body,
    hashlib.sha256,
).hexdigest().encode("ascii")
headers_path.write_bytes(
    b"Authorization: " + authorization + b"\n"
    b"X-RevenueCat-Webhook-Signature: t=" + timestamp + b",v1=" + signature + b"\n"
    b"Content-Type: application/json\n"
)
os.chmod(headers_path, 0o600)
PYTHON
}

prepare_candidate_webhook_smoke() {
  local desired_refs="$1"
  local webhook_authorization_version webhook_signing_secret_version timestamp event_timestamp_ms

  webhook_authorization_version="$(jq -r \
    '.GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION.version' <<< "${desired_refs}")"
  webhook_signing_secret_version="$(jq -r \
    '.GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET.version' <<< "${desired_refs}")"

  webhook_authorization_file="$(mktemp "${work_dir}/webhook-authorization.XXXXXX")"
  webhook_signing_secret_file="$(mktemp "${work_dir}/webhook-signing-secret.XXXXXX")"
  webhook_payload_file="$(mktemp "${work_dir}/webhook-payload.XXXXXX")"
  webhook_headers_file="$(mktemp "${work_dir}/webhook-headers.XXXXXX")"
  chmod 600 \
    "${webhook_authorization_file}" \
    "${webhook_signing_secret_file}" \
    "${webhook_payload_file}" \
    "${webhook_headers_file}"

  gcloud secrets versions access "${webhook_authorization_version}" \
    --secret="glidelingo-revenuecat-webhook-authorization" \
    --project="${expected_project}" \
    --out-file="${webhook_authorization_file}" \
    --quiet >/dev/null
  gcloud secrets versions access "${webhook_signing_secret_version}" \
    --secret="glidelingo-revenuecat-webhook-signing-secret" \
    --project="${expected_project}" \
    --out-file="${webhook_signing_secret_file}" \
    --quiet >/dev/null
  chmod 600 "${webhook_authorization_file}" "${webhook_signing_secret_file}"

  timestamp="$(date -u +%s)"
  event_timestamp_ms="$((10#${timestamp} * 1000))"
  jq -cn --argjson event_timestamp_ms "${event_timestamp_ms}" '
    {
      api_version: "1.0",
      event: {
        id: "glidelingo-local-activation-test",
        type: "TEST",
        event_timestamp_ms: $event_timestamp_ms,
        environment: "SANDBOX"
      }
    }
  ' > "${webhook_payload_file}"

  write_webhook_headers \
    "${webhook_authorization_file}" \
    "${webhook_signing_secret_file}" \
    "${webhook_payload_file}" \
    "${timestamp}" \
    "${webhook_headers_file}"

  webhook_signature_timestamp="${timestamp}"
}

candidate_webhook_smoke() {
  local base_url="$1"
  local status

  status="$(curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 20 \
    --output /dev/null \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary "@${webhook_payload_file}" \
    --write-out '%{http_code}' \
    "${base_url}/v1/billing/revenuecat/webhook")" || return 1
  if [[ "${status}" != "401" ]]; then
    echo "Expected the enabled candidate webhook to reject missing credentials with 401; received ${status}." >&2
    return 1
  fi

  status="$(curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 20 \
    --output /dev/null \
    --request POST \
    --header 'Content-Type: application/json' \
    --header 'Authorization: invalid-local-activation-credential' \
    --header "X-RevenueCat-Webhook-Signature: t=${webhook_signature_timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000" \
    --data-binary "@${webhook_payload_file}" \
    --write-out '%{http_code}' \
    "${base_url}/v1/billing/revenuecat/webhook")" || return 1
  if [[ "${status}" != "401" ]]; then
    echo "Expected the enabled candidate webhook to reject bad credentials with 401; received ${status}." >&2
    return 1
  fi

  : > "${response_file}"
  status="$(curl --silent --show-error \
    --connect-timeout 5 \
    --max-time 20 \
    --output "${response_file}" \
    --request POST \
    --header "@${webhook_headers_file}" \
    --data-binary "@${webhook_payload_file}" \
    --write-out '%{http_code}' \
    "${base_url}/v1/billing/revenuecat/webhook")" || return 1
  if [[ "${status}" != "200" ]]; then
    echo "Locally signed candidate webhook returned ${status}; expected 200. Response body was withheld." >&2
    return 1
  fi
  if ! jq -e 'type == "object" and keys == ["status"] and .status == "ignored"' \
    "${response_file}" >/dev/null; then
    echo "Locally signed TEST webhook did not return the exact ignored response. Response body was withheld." >&2
    return 1
  fi
}

main() {
trap cleanup EXIT

require_command gcloud
require_command curl
require_command jq
require_command python3

desired_secret_refs="$(desired_revenuecat_secret_refs 2>/dev/null)" \
  || die "Activation requires ${revenuecat_tfvars_file} to remain disabled while naming all four exact positive version strings."

if [[ ! -t 0 || ! -t 1 ]]; then
  die "Run this activation interactively from a terminal; hidden Clerk token input requires a TTY."
fi

active_project="$(gcloud config get-value project 2>/dev/null)"
if [[ "${active_project}" != "${expected_project}" ]]; then
  die "Expected active gcloud project ${expected_project}; found ${active_project:-unset}."
fi
active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
if [[ -z "${active_account}" ]]; then
  die "An active gcloud account is required."
fi

initial_service_json="$(describe_service)" || die "Could not describe ${expected_service} in ${expected_project}/${expected_region}."
service_name="$(jq -r '.metadata.name // empty' <<< "${initial_service_json}")"
service_location="$(jq -r '.metadata.labels["cloud.googleapis.com/location"] // empty' <<< "${initial_service_json}")"
service_url="$(jq -r '.status.url // empty' <<< "${initial_service_json}")"
initial_generation="$(jq -r '.metadata.generation // empty' <<< "${initial_service_json}")"
initial_observed_generation="$(jq -r '.status.observedGeneration // empty' <<< "${initial_service_json}")"
previous_revision="$(one_hundred_percent_revision <<< "${initial_service_json}")"
initial_template_flag="$(template_revenuecat_flag <<< "${initial_service_json}")"
initial_secret_refs="$(revenuecat_secret_refs service <<< "${initial_service_json}" 2>/dev/null)" \
  || die "The current service template must contain the four expected RevenueCat Secret Manager refs with immutable positive numeric versions."

[[ "${service_name}" == "${expected_service}" ]] || die "The described Cloud Run service is not exactly ${expected_service}."
if [[ -n "${service_location}" && "${service_location}" != "${expected_region}" ]]; then
  die "Expected service region ${expected_region}; found ${service_location}."
fi
[[ -n "${service_url}" ]] || die "The service has no canonical URL."
[[ "${initial_generation}" =~ ^[1-9][0-9]*$ \
  && "${initial_generation}" == "${initial_observed_generation}" ]] \
  || die "Cloud Run generation is not fully observed; wait for the service to stabilize."
[[ -n "${previous_revision}" ]] \
  || die "Exactly one resolved revision must serve 100% before activation."
[[ "${initial_template_flag}" == "false" ]] \
  || die "The current service template must explicitly set ${revenuecat_flag}=false before activation."
[[ "${initial_secret_refs}" == "${desired_secret_refs}" ]] \
  || die "The live disabled template secret refs do not exactly match ${revenuecat_tfvars_file}."

previous_revision_json="$(describe_revision "${previous_revision}")" \
  || die "Could not describe the 100%-serving revision ${previous_revision}."
previous_flag="$(revision_revenuecat_flag <<< "${previous_revision_json}")"
[[ "${previous_flag}" == "false" ]] \
  || die "The 100%-serving revision must explicitly set ${revenuecat_flag}=false before activation."

echo "RevenueCat development activation preconditions:" >&2
echo "  - migration 002 and exact runtime grants are applied" >&2
echo "  - all four RevenueCat Secret Manager versions are pinned on the disabled template" >&2
echo "  - the RevenueCat dashboard sandbox webhook has valid Authorization and HMAC signing" >&2
echo "  - dashboard delivery reachability evidence exists; a disabled canonical 503 is expected" >&2
echo "  - this Clerk user currently owns an active SANDBOX Pro entitlement" >&2
printf 'Type ACTIVATE to stage and test a zero-traffic enabled revision: ' >&2
IFS= read -r confirmation
[[ "${confirmation}" == "ACTIVATE" ]] || die "Activation cancelled."

printf 'Paste a freshly issued short-lived Clerk session token (input hidden): ' >&2
IFS= read -r -s clerk_token
printf '\n' >&2
if [[ ! "${clerk_token}" =~ ^[A-Za-z0-9._-]{20,}$ ]]; then
  unset clerk_token
  die "The Clerk session token format is invalid."
fi

umask 077
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/glidelingo-rc-activation.XXXXXX")"
curl_config="${work_dir}/curl.conf"
response_file="${work_dir}/response.json"
: > "${curl_config}"
: > "${response_file}"
chmod 600 "${curl_config}" "${response_file}"
printf 'header = "Authorization: Bearer %s"\n' "${clerk_token}" > "${curl_config}"
unset clerk_token

candidate_tag="rc-activate-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
if (( ${#candidate_tag} > 63 )) || [[ ! "${candidate_tag}" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]]; then
  die "Generated candidate tag is not a valid bounded Cloud Run tag."
fi

echo "Re-checking Cloud Run state immediately before staging." >&2
prestaging_json="$(describe_service)" || die "Could not perform the pre-staging service check."
prestaging_generation="$(jq -r '.metadata.generation // empty' <<< "${prestaging_json}")"
prestaging_observed_generation="$(jq -r '.status.observedGeneration // empty' <<< "${prestaging_json}")"
prestaging_previous_revision="$(one_hundred_percent_revision <<< "${prestaging_json}")"
prestaging_url="$(jq -r '.status.url // empty' <<< "${prestaging_json}")"
prestaging_template_flag="$(template_revenuecat_flag <<< "${prestaging_json}")"
prestaging_secret_refs="$(revenuecat_secret_refs service <<< "${prestaging_json}" 2>/dev/null)" \
  || die "The service template RevenueCat secret refs became invalid before staging."

[[ "${prestaging_generation}" == "${initial_generation}" \
  && "${prestaging_observed_generation}" == "${initial_generation}" ]] \
  || die "Cloud Run generation drifted before candidate staging."
[[ "${prestaging_previous_revision}" == "${previous_revision}" ]] \
  || die "The 100%-serving revision drifted before candidate staging."
[[ "${prestaging_url}" == "${service_url}" ]] \
  || die "The canonical service URL drifted before candidate staging."
[[ "${prestaging_template_flag}" == "false" ]] \
  || die "The service template RevenueCat flag drifted before candidate staging."
[[ "${prestaging_secret_refs}" == "${initial_secret_refs}" \
  && "${prestaging_secret_refs}" == "${desired_secret_refs}" ]] \
  || die "A RevenueCat secret ref or pinned version drifted before candidate staging."
if jq -e --arg tag "${candidate_tag}" '.status.traffic[]? | select(.tag == $tag)' \
  <<< "${prestaging_json}" >/dev/null; then
  die "Generated candidate tag already exists; rerun the script."
fi

echo "Staging an enabled zero-traffic candidate." >&2
staged=true
gcloud run services update "${expected_service}" \
  --project="${expected_project}" \
  --region="${expected_region}" \
  --update-env-vars="${revenuecat_flag}=true" \
  --no-traffic \
  --tag="${candidate_tag}" \
  --quiet >/dev/null

staged_service_json="$(describe_service)" || die "Could not inspect the staged service."
expected_generation="$(jq -r '.metadata.generation // empty' <<< "${staged_service_json}")"
expected_observed_generation="$(jq -r '.status.observedGeneration // empty' <<< "${staged_service_json}")"
staged_previous_revision="$(one_hundred_percent_revision <<< "${staged_service_json}")"
staged_template_flag="$(template_revenuecat_flag <<< "${staged_service_json}")"
staged_secret_refs="$(revenuecat_secret_refs service <<< "${staged_service_json}" 2>/dev/null)" \
  || die "The staged service template does not contain the required immutable RevenueCat secret refs."
candidate_traffic="$(jq -c --arg tag "${candidate_tag}" \
  '[.status.traffic[]? | select(.tag == $tag)] | if length == 1 then .[0] else empty end' \
  <<< "${staged_service_json}")"
candidate_revision="$(jq -r '.revisionName // empty' <<< "${candidate_traffic}")"
candidate_url="$(jq -r '.url // empty' <<< "${candidate_traffic}")"
candidate_percent="$(jq -r '.percent // 0' <<< "${candidate_traffic}")"

is_exact_next_generation "${initial_generation}" "${expected_generation}" \
  || die "Candidate staging did not produce exactly the next Cloud Run generation."
[[ "${expected_generation}" == "${expected_observed_generation}" ]] \
  || die "The staged Cloud Run generation did not become fully observed."
[[ "${staged_previous_revision}" == "${previous_revision}" ]] \
  || die "Traffic moved while staging; refusing activation."
[[ "${staged_template_flag}" == "true" ]] \
  || die "The staged service template is not RevenueCat enabled."
[[ "${staged_secret_refs}" == "${initial_secret_refs}" ]] \
  || die "The staged service template changed a RevenueCat secret ref or pinned version."
[[ -n "${candidate_revision}" && -n "${candidate_url}" && "${candidate_percent}" == "0" ]] \
  || die "The exact candidate tag must resolve to one zero-traffic revision and URL."

candidate_revision_json="$(describe_revision "${candidate_revision}")" \
  || die "Could not describe candidate revision ${candidate_revision}."
candidate_flag="$(revision_revenuecat_flag <<< "${candidate_revision_json}")"
candidate_secret_refs="$(revenuecat_secret_refs revision <<< "${candidate_revision_json}" 2>/dev/null)" \
  || die "The exact candidate revision does not expose the required immutable RevenueCat secret refs."
[[ "${candidate_flag}" == "true" ]] \
  || die "The exact candidate revision is not RevenueCat enabled."
[[ "${candidate_secret_refs}" == "${initial_secret_refs}" ]] \
  || die "The exact candidate revision changed a RevenueCat secret ref or pinned version."

echo "Running zero-traffic candidate smoke checks." >&2
health_smoke "${candidate_url}"
invalid_auth_smoke "${candidate_url}"
prepare_candidate_webhook_smoke "${desired_secret_refs}"
candidate_webhook_smoke "${candidate_url}"
authenticated_entitlement_smoke "${candidate_url}" POST "/v1/billing/entitlements/pro/reconcile"
authenticated_entitlement_smoke "${candidate_url}" GET "/v1/billing/entitlements/pro"

echo "Re-checking Cloud Run state immediately before promotion." >&2
prepromotion_json="$(describe_service)" || die "Could not perform the pre-promotion service check."
prepromotion_generation="$(jq -r '.metadata.generation // empty' <<< "${prepromotion_json}")"
prepromotion_observed_generation="$(jq -r '.status.observedGeneration // empty' <<< "${prepromotion_json}")"
prepromotion_previous_revision="$(one_hundred_percent_revision <<< "${prepromotion_json}")"
prepromotion_url="$(jq -r '.status.url // empty' <<< "${prepromotion_json}")"
prepromotion_template_flag="$(template_revenuecat_flag <<< "${prepromotion_json}")"
prepromotion_secret_refs="$(revenuecat_secret_refs service <<< "${prepromotion_json}" 2>/dev/null)" \
  || die "The service template RevenueCat secret refs became invalid before promotion."
prepromotion_candidate_traffic="$(jq -c --arg tag "${candidate_tag}" \
  '[.status.traffic[]? | select(.tag == $tag)] | if length == 1 then .[0] else empty end' \
  <<< "${prepromotion_json}")"
prepromotion_candidate_revision="$(jq -r '.revisionName // empty' <<< "${prepromotion_candidate_traffic}")"
prepromotion_candidate_percent="$(jq -r '.percent // 0' <<< "${prepromotion_candidate_traffic}")"

[[ "${prepromotion_generation}" == "${expected_generation}" \
  && "${prepromotion_observed_generation}" == "${expected_generation}" ]] \
  || die "Cloud Run generation drifted after candidate staging."
[[ "${prepromotion_previous_revision}" == "${previous_revision}" ]] \
  || die "The 100%-serving revision drifted after candidate staging."
[[ "${prepromotion_url}" == "${service_url}" ]] \
  || die "The canonical service URL drifted after candidate staging."
[[ "${prepromotion_candidate_revision}" == "${candidate_revision}" \
  && "${prepromotion_candidate_percent}" == "0" ]] \
  || die "The candidate tag, revision, or zero-traffic state drifted before promotion."
[[ "${prepromotion_template_flag}" == "true" ]] \
  || die "The service template RevenueCat flag drifted before promotion."
[[ "${prepromotion_secret_refs}" == "${initial_secret_refs}" ]] \
  || die "A RevenueCat secret ref or pinned version drifted before promotion."

previous_revision_json="$(describe_revision "${previous_revision}")" \
  || die "Could not re-check previous revision ${previous_revision}."
candidate_revision_json="$(describe_revision "${candidate_revision}")" \
  || die "Could not re-check candidate revision ${candidate_revision}."
previous_flag="$(revision_revenuecat_flag <<< "${previous_revision_json}")"
candidate_flag="$(revision_revenuecat_flag <<< "${candidate_revision_json}")"
candidate_secret_refs="$(revenuecat_secret_refs revision <<< "${candidate_revision_json}" 2>/dev/null)" \
  || die "The candidate RevenueCat secret refs became invalid before promotion."
[[ "${previous_flag}" == "false" && "${candidate_flag}" == "true" ]] \
  || die "Previous or candidate RevenueCat flags drifted before promotion."
[[ "${candidate_secret_refs}" == "${initial_secret_refs}" ]] \
  || die "The candidate RevenueCat secret refs drifted before promotion."

echo "Promoting exact revision ${candidate_revision} to 100% traffic." >&2
if ! gcloud run services update-traffic "${expected_service}" \
  --project="${expected_project}" \
  --region="${expected_region}" \
  --to-revisions="${candidate_revision}=100" \
  --quiet >/dev/null; then
  rollback_previous_revision || true
  die "Candidate promotion failed."
fi
traffic_promoted=true

promoted_service_json="$(describe_service)" || die "Could not inspect promoted traffic."
promoted_revision="$(one_hundred_percent_revision <<< "${promoted_service_json}")"
[[ "${promoted_revision}" == "${candidate_revision}" ]] \
  || die "The exact candidate revision did not become the sole 100%-serving revision."

echo "Running canonical post-promotion smoke checks." >&2
health_smoke "${service_url}"
authenticated_entitlement_smoke "${service_url}" GET "/v1/billing/entitlements/pro"
authenticated_entitlement_smoke "${service_url}" POST "/v1/billing/entitlements/pro/reconcile"

activation_complete=true
remove_candidate_tag
candidate_tag=""

echo "RevenueCat development activation succeeded on revision ${candidate_revision}." >&2
echo "Provider delivery is not fully accepted yet:" >&2
echo "  Send a real RevenueCat dashboard SANDBOX test to the canonical webhook and require HTTP 200." >&2
echo "  This script proved local signing with exact pinned credentials, not RevenueCat delivery." >&2
echo "Next required reconciliation (not run automatically):" >&2
echo "  In a reviewed update to infra/gcp/environments/development/revenuecat.auto.tfvars.json," >&2
echo "  change only revenuecat_enabled from false to true and retain the four exact pinned versions." >&2
echo "  Run Terraform plan and require no Cloud Run template or traffic change before applying it." >&2
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
