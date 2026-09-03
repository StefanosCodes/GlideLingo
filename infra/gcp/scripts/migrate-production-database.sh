#!/usr/bin/env bash
set -euo pipefail

expected_project="glidelingo-prod-50843312405"
project_id="${GLIDELINGO_GCP_PROJECT_ID:-${expected_project}}"
instance="glidelingo-production-db"
database="glidelingo"
port="${GLIDELINGO_PRODUCTION_MIGRATION_PORT:-55434}"
operator="glidelingo_migrator_$(date -u +%Y%m%d%H%M%S)"

if [[ "${project_id}" != "${expected_project}" ]]; then
  echo "Migration accepts only ${expected_project}." >&2
  exit 1
fi
if [[ "$(gcloud config get-value project 2>/dev/null)" != "${project_id}" ]]; then
  echo "Active gcloud project must be exactly ${project_id}." >&2
  exit 1
fi
for command in gcloud cloud-sql-proxy psql openssl curl python3; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required." >&2; exit 1; }
done
if [[ "${GLIDELINGO_CONFIRM_PRODUCTION_MIGRATION:-}" != "${project_id}" ]]; then
  echo "Set GLIDELINGO_CONFIRM_PRODUCTION_MIGRATION=${project_id} for this reviewed one-time operation." >&2
  exit 1
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/glidelingo-production-migration.XXXXXX")"
password_file="${temporary_dir}/pgpass"
user_request_file="${temporary_dir}/create-user.json"
user_response_file="${temporary_dir}/create-user-response.json"
curl_config_file="${temporary_dir}/create-user.curl"
operator_password="$(openssl rand -base64 36 | tr -d '\n')"
proxy_pid=""
operator_created=false
cleanup() {
  local exit_status=$?
  if [[ -n "${proxy_pid}" ]]; then kill "${proxy_pid}" >/dev/null 2>&1 || true; fi
  if [[ "${operator_created}" == true ]]; then
    gcloud sql users delete "${operator}" --project="${project_id}" --instance="${instance}" --quiet >/dev/null 2>&1 || \
      echo "WARNING: delete temporary operator ${operator} manually." >&2
  fi
  unset operator_password
  rm -f -- "${password_file}" "${user_request_file}" "${user_response_file}" "${curl_config_file}"
  rmdir -- "${temporary_dir}" >/dev/null 2>&1 || true
  exit "${exit_status}"
}
trap cleanup EXIT INT TERM

access_token="$(gcloud auth print-access-token)"
printf '{"name":"%s","password":"%s","type":"BUILT_IN","databaseRoles":["cloudsqlsuperuser"]}\n' \
  "${operator}" "${operator_password}" > "${user_request_file}"
printf '%s\n' \
  'silent' \
  'show-error' \
  'fail-with-body' \
  'request = "POST"' \
  "header = \"Authorization: Bearer ${access_token}\"" \
  'header = "Content-Type: application/json"' \
  "data = @${user_request_file}" \
  "url = \"https://sqladmin.googleapis.com/sql/v1beta4/projects/${project_id}/instances/${instance}/users\"" \
  "output = \"${user_response_file}\"" > "${curl_config_file}"
unset access_token
chmod 600 "${user_request_file}" "${curl_config_file}"
operator_created=true
curl --config "${curl_config_file}"
operation_name="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["name"])' "${user_response_file}")"
gcloud sql operations wait "${operation_name}" --project="${project_id}" --timeout=300
printf '127.0.0.1:%s:%s:%s:%s\n' "${port}" "${database}" "${operator}" "${operator_password}" > "${password_file}"
chmod 600 "${password_file}"
unset operator_password

connection_name="$(gcloud sql instances describe "${instance}" --project="${project_id}" --format='value(connectionName)')"
cloud-sql-proxy "${connection_name}" --address=127.0.0.1 --port="${port}" >/dev/null 2>&1 &
proxy_pid=$!
for _ in {1..30}; do
  if PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done

PGPASSFILE="${password_file}" \
GLIDELINGO_MIGRATION_HOST=127.0.0.1 \
GLIDELINGO_MIGRATION_PORT="${port}" \
GLIDELINGO_MIGRATION_USER="${operator}" \
GLIDELINGO_MIGRATION_DATABASE="${database}" \
  ./infra/gcp/scripts/run-versioned-production-migrations.sh

PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 \
  -c 'SET ROLE cloudsqlsuperuser' \
  -c 'SET search_path = public' \
  -f infra/gcp/scripts/schedule-revenuecat-webhook-maintenance.sql

PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('lesson_tutor_turn_guard','revenuecat_entitlement_state','revenuecat_webhook_event')" \
  | grep -Fxq '3'
PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname='${operator}'" \
  | grep -Fxq '0'

echo "Production migrations and ownership checks completed; temporary operator will now be deleted."
