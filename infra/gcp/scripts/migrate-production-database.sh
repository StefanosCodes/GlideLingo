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
for command in gcloud cloud-sql-proxy psql openssl; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required." >&2; exit 1; }
done
if [[ "${GLIDELINGO_CONFIRM_PRODUCTION_MIGRATION:-}" != "${project_id}" ]]; then
  echo "Set GLIDELINGO_CONFIRM_PRODUCTION_MIGRATION=${project_id} for this reviewed one-time operation." >&2
  exit 1
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/glidelingo-production-migration.XXXXXX")"
password_file="${temporary_dir}/pgpass"
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
  rm -f -- "${password_file}"
  rmdir -- "${temporary_dir}" >/dev/null 2>&1 || true
  exit "${exit_status}"
}
trap cleanup EXIT INT TERM

gcloud sql users create "${operator}" \
  --project="${project_id}" \
  --instance="${instance}" \
  --type=BUILT_IN \
  --database-roles=cloudsqlsuperuser
operator_created=true
printf '%s\n' "${operator_password}" | gcloud sql users set-password "${operator}" \
  --project="${project_id}" \
  --instance="${instance}" \
  --prompt-for-password
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

PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 \
  -c 'SET ROLE cloudsqlsuperuser' \
  -c 'SET search_path = public' \
  -c "SET statement_timeout = '30s'; SET lock_timeout = '5s'" \
  -f backend/migrations/001_lesson_tutor_guard.sql \
  -f backend/migrations/002_revenuecat_entitlements.sql \
  -f backend/migrations/003_revenuecat_webhook_maintenance.sql \
  -f infra/gcp/scripts/schedule-revenuecat-webhook-maintenance.sql

PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('lesson_tutor_turn_guard','revenuecat_entitlement_state','revenuecat_webhook_event')" \
  | grep -Fxq '3'
PGPASSFILE="${password_file}" psql -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname='${operator}'" \
  | grep -Fxq '0'

echo "Production migrations and ownership checks completed; temporary operator will now be deleted."
