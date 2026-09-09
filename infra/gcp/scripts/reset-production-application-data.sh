#!/usr/bin/env bash
set -euo pipefail

expected_project="glidelingo-prod-50843312405"
project_id="${GLIDELINGO_GCP_PROJECT_ID:-${expected_project}}"
instance="glidelingo-production-db"
database="glidelingo"
port="${GLIDELINGO_PRODUCTION_RESET_PORT:-55434}"
operator="glidelingo_reset_$(date -u +%Y%m%d%H%M%S)"
proxy_version="2.23.0"

usage() {
  cat >&2 <<EOF
Usage: npm run db:reset:production -- --confirm ${expected_project}

Deletes every row from the reviewed GlideLingo production application tables.
It preserves the Cloud SQL instance, schema, migration ledger, roles, backups,
and point-in-time recovery configuration.
EOF
}

if [[ "${project_id}" != "${expected_project}" ]]; then
  echo "Reset accepts only ${expected_project}." >&2
  exit 1
fi
if [[ "${1:-}" != "--confirm" || "${2:-}" != "${expected_project}" || $# -ne 2 ]]; then
  usage
  exit 1
fi
for command in gcloud openssl curl python3 uname lsof; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required." >&2; exit 1; }
done
if command -v psql >/dev/null 2>&1; then
  psql_binary="$(command -v psql)"
elif [[ -x /Applications/Postgres.app/Contents/Versions/latest/bin/psql ]]; then
  psql_binary="/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
else
  echo "psql is required (PATH or Postgres.app)." >&2
  exit 1
fi
if [[ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)" ]]; then
  echo "An active gcloud operator account is required." >&2
  exit 1
fi
if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Local port ${port} is already occupied; refusing to reuse an unverified listener." >&2
  exit 1
fi

instance_contract="$(
  gcloud sql instances describe "${instance}" --project="${project_id}" --format=json \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); b=d.get("settings",{}).get("backupConfiguration",{}); print("|".join((str(d.get("project","")),str(d.get("state","")),str(b.get("enabled",False)).lower(),str(b.get("pointInTimeRecoveryEnabled",False)).lower(),str(d.get("connectionName","")))))'
)"
IFS='|' read -r resolved_project instance_state backups_enabled pitr_enabled connection_name <<< "${instance_contract}"
if [[ "${resolved_project}" != "${expected_project}" || "${instance_state}" != "RUNNABLE" ]]; then
  echo "The exact production instance is not RUNNABLE; refusing to reset." >&2
  exit 1
fi
if [[ "${backups_enabled}" != "true" || "${pitr_enabled}" != "true" ]]; then
  echo "Production backups and point-in-time recovery must both be enabled." >&2
  exit 1
fi
latest_backup="$(
  gcloud sql backups list --project="${project_id}" --instance="${instance}" \
    --filter='status=SUCCESSFUL' --sort-by='~endTime' --limit=1 --format='value(id)'
)"
if [[ -z "${latest_backup}" ]]; then
  echo "No successful production backup was found; refusing to reset." >&2
  exit 1
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/glidelingo-production-reset.XXXXXX")"
password_file="${temporary_dir}/pgpass"
user_request_file="${temporary_dir}/create-user.json"
user_response_file="${temporary_dir}/create-user-response.json"
curl_config_file="${temporary_dir}/create-user.curl"
proxy_log_file="${temporary_dir}/cloud-sql-proxy.log"
proxy_binary=""
operator_password="$(openssl rand -base64 36 | tr -d '\n')"
proxy_pid=""
operator_created=false
cleanup() {
  local exit_status=$?
  if [[ -n "${proxy_pid}" ]]; then
    kill "${proxy_pid}" >/dev/null 2>&1 || true
    wait "${proxy_pid}" >/dev/null 2>&1 || true
  fi
  if [[ "${operator_created}" == true ]]; then
    gcloud sql users delete "${operator}" --project="${project_id}" --instance="${instance}" --quiet >/dev/null 2>&1 || \
      echo "WARNING: delete temporary operator ${operator} manually." >&2
  fi
  unset operator_password
  rm -f -- "${password_file}" "${user_request_file}" "${user_response_file}" \
    "${curl_config_file}" "${proxy_log_file}"
  if [[ "${proxy_binary}" == "${temporary_dir}/cloud-sql-proxy" ]]; then
    rm -f -- "${proxy_binary}"
  fi
  rmdir -- "${temporary_dir}" >/dev/null 2>&1 || true
  exit "${exit_status}"
}
trap cleanup EXIT INT TERM

if command -v cloud-sql-proxy >/dev/null 2>&1; then
  proxy_binary="$(command -v cloud-sql-proxy)"
else
  platform="$(uname -s)"
  architecture="$(uname -m)"
  case "${platform}/${architecture}" in
    Darwin/arm64)
      proxy_asset="cloud-sql-proxy.darwin.arm64"
      proxy_sha256="d5233967a8b5141bd1e95edcad2fb9930357d3ffbd9f433b82fc4a538d3fd68b"
      ;;
    Darwin/x86_64)
      proxy_asset="cloud-sql-proxy.darwin.amd64"
      proxy_sha256="8089f6bab724a68c5e47b74759671db091df44b36e84cd273c1b899068f7a173"
      ;;
    Linux/aarch64|Linux/arm64)
      proxy_asset="cloud-sql-proxy.linux.arm64"
      proxy_sha256="23f63b36d1eda329a0751a5185f3ddbbfda1a5996846fcd5b408601e0981c963"
      ;;
    Linux/x86_64|Linux/amd64)
      proxy_asset="cloud-sql-proxy.linux.amd64"
      proxy_sha256="cd689d582b826fa5bc82c01ccc14e45a58200c3cefbf923ce96c422825e4e6f6"
      ;;
    *)
      echo "Unsupported Cloud SQL proxy platform ${platform}/${architecture}." >&2
      exit 1
      ;;
  esac
  proxy_binary="${temporary_dir}/cloud-sql-proxy"
  proxy_url="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v${proxy_version}/${proxy_asset}"
  curl --fail --location --silent --show-error --retry 3 --output "${proxy_binary}" "${proxy_url}"
  actual_sha256="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "${proxy_binary}")"
  if [[ "${actual_sha256}" != "${proxy_sha256}" ]]; then
    echo "Downloaded Cloud SQL Auth Proxy checksum mismatch." >&2
    exit 1
  fi
  chmod 700 "${proxy_binary}"
fi

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
operation_name="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["name"])' "${user_response_file}")"
gcloud sql operations wait "${operation_name}" --project="${project_id}" --timeout=300
printf '127.0.0.1:%s:%s:%s:%s\n' "${port}" "${database}" "${operator}" "${operator_password}" > "${password_file}"
chmod 600 "${password_file}"
unset operator_password

"${proxy_binary}" "${connection_name}" --address=127.0.0.1 --port="${port}" >"${proxy_log_file}" 2>&1 &
proxy_pid=$!
proxy_ready=false
for _ in {1..30}; do
  if PGPASSFILE="${password_file}" "${psql_binary}" -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
    -v ON_ERROR_STOP=1 -tAc 'SELECT 1' >/dev/null 2>&1; then
    proxy_ready=true
    break
  fi
  sleep 1
done
if [[ "${proxy_ready}" != true ]]; then
  echo "Cloud SQL Auth Proxy did not become ready:" >&2
  sed -n '1,80p' "${proxy_log_file}" >&2
  exit 1
fi

table_contract="$(
  PGPASSFILE="${password_file}" "${psql_binary}" -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
    -v ON_ERROR_STOP=1 -AtF '|' -c 'SET ROLE cloudsqlsuperuser' \
    -c "SELECT to_regclass('public.lesson_tutor_turn_guard') IS NOT NULL, to_regclass('public.revenuecat_entitlement_state') IS NOT NULL, to_regclass('public.revenuecat_webhook_event') IS NOT NULL, to_regclass('public.glidelingo_schema_migration') IS NOT NULL" | tail -n 1
)"
if [[ "${table_contract}" != "t|t|t|t" ]]; then
  echo "The reviewed production table contract has changed; refusing to reset." >&2
  exit 1
fi
ledger_before="$(
  PGPASSFILE="${password_file}" "${psql_binary}" -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
    -v ON_ERROR_STOP=1 -At -c 'SET ROLE cloudsqlsuperuser' \
    -c 'SELECT count(*) FROM public.glidelingo_schema_migration' | tail -n 1
)"

echo "Resetting application rows in ${project_id}/${instance}/${database}; latest successful backup ID: ${latest_backup}."
PGPASSFILE="${password_file}" "${psql_binary}" -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
  -v ON_ERROR_STOP=1 -P pager=off -c "
SET ROLE cloudsqlsuperuser;
BEGIN;
SET LOCAL search_path = public;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
LOCK TABLE lesson_tutor_turn_guard, revenuecat_entitlement_state, revenuecat_webhook_event IN ACCESS EXCLUSIVE MODE;
SELECT 'before' AS phase,
  (SELECT count(*) FROM lesson_tutor_turn_guard) AS lesson_tutor_turn_guard,
  (SELECT count(*) FROM revenuecat_entitlement_state) AS revenuecat_entitlement_state,
  (SELECT count(*) FROM revenuecat_webhook_event) AS revenuecat_webhook_event,
  (SELECT count(*) FROM glidelingo_schema_migration) AS schema_migrations;
DELETE FROM public.lesson_tutor_turn_guard;
DELETE FROM public.revenuecat_webhook_event;
DELETE FROM public.revenuecat_entitlement_state;
SELECT 'after' AS phase,
  (SELECT count(*) FROM lesson_tutor_turn_guard) AS lesson_tutor_turn_guard,
  (SELECT count(*) FROM revenuecat_entitlement_state) AS revenuecat_entitlement_state,
  (SELECT count(*) FROM revenuecat_webhook_event) AS revenuecat_webhook_event,
  (SELECT count(*) FROM glidelingo_schema_migration) AS schema_migrations;
COMMIT;"

verification="$(
  PGPASSFILE="${password_file}" "${psql_binary}" -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
    -v ON_ERROR_STOP=1 -AtF '|' -c 'SET ROLE cloudsqlsuperuser' \
    -c 'SELECT (SELECT count(*) FROM public.lesson_tutor_turn_guard), (SELECT count(*) FROM public.revenuecat_entitlement_state), (SELECT count(*) FROM public.revenuecat_webhook_event), (SELECT count(*) FROM public.glidelingo_schema_migration)' | tail -n 1
)"
IFS='|' read -r tutor_after entitlement_after webhook_after ledger_after <<< "${verification}"
if [[ "${tutor_after}" != "0" || "${entitlement_after}" != "0" || "${webhook_after}" != "0" ]]; then
  echo "Production reset verification found remaining application rows." >&2
  exit 1
fi
if [[ "${ledger_after}" != "${ledger_before}" ]]; then
  echo "Production migration ledger changed during reset." >&2
  exit 1
fi
owner_count="$(
  PGPASSFILE="${password_file}" "${psql_binary}" -X -h 127.0.0.1 -p "${port}" -U "${operator}" -d "${database}" \
    -v ON_ERROR_STOP=1 -At -c 'SET ROLE cloudsqlsuperuser' \
    -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname='${operator}'" | tail -n 1
)"
if [[ "${owner_count}" != "0" ]]; then
  echo "Temporary production reset operator unexpectedly owns public objects." >&2
  exit 1
fi

echo "Production application data is empty; ${ledger_after} migration ledger rows were preserved. Temporary operator will now be deleted."
