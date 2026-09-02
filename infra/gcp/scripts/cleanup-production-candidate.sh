#!/usr/bin/env bash
set -euo pipefail

expected_project="glidelingo-prod-50843312405"
region="us-west1"
service="glidelingo-api-production"
candidate_tag="${1:-}"
candidate_revision="${2:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
classifier="${script_dir}/classify-production-candidate-cleanup.sh"

if [[ "$(gcloud config get-value project 2>/dev/null)" != "${expected_project}" ]]; then
  echo "Active gcloud project must be exactly ${expected_project}." >&2
  exit 1
fi
if [[ ! "${candidate_tag}" =~ ^candidate-[0-9a-f]{40}$ || -z "${candidate_revision}" ]]; then
  echo "Usage: $0 candidate-FORTY_CHARACTER_COMMIT EXACT_CLOUD_RUN_REVISION" >&2
  exit 2
fi

service_json="$(gcloud run services describe "${service}" --project="${expected_project}" --region="${region}" --format=json)"
generation="$(jq -r '.metadata.generation // empty' <<< "${service_json}")"
action="$("${classifier}" "${candidate_tag}" "${candidate_revision}" <<< "${service_json}")"
if [[ "${action}" == "absent" ]]; then
  echo "The exact candidate tag is already absent."
  exit 0
fi
test "${action}" = "remove"

precleanup_json="$(gcloud run services describe "${service}" --project="${expected_project}" --region="${region}" --format=json)"
test "$(jq -r '.metadata.generation // empty' <<< "${precleanup_json}")" = "${generation}"
test "$("${classifier}" "${candidate_tag}" "${candidate_revision}" <<< "${precleanup_json}")" = "remove"
gcloud run services update-traffic "${service}" \
  --project="${expected_project}" \
  --region="${region}" \
  --remove-tags="${candidate_tag}" \
  --quiet
updated_json="$(gcloud run services describe "${service}" --project="${expected_project}" --region="${region}" --format=json)"
test "$("${classifier}" "${candidate_tag}" "${candidate_revision}" <<< "${updated_json}")" = "absent"
echo "Removed the exact abandoned zero-traffic candidate tag."
