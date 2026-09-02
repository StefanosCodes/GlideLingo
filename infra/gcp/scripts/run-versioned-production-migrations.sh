#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
psql_bin="${GLIDELINGO_PSQL_BIN:-psql}"
host="${GLIDELINGO_MIGRATION_HOST:-127.0.0.1}"
port="${GLIDELINGO_MIGRATION_PORT:-55434}"
user="${GLIDELINGO_MIGRATION_USER:?GLIDELINGO_MIGRATION_USER is required}"
database="${GLIDELINGO_MIGRATION_DATABASE:-glidelingo}"

psql_args=(-X --quiet --host="${host}" --port="${port}" --username="${user}" --dbname="${database}" --set=ON_ERROR_STOP=1)
migration_files=(
  "backend/migrations/001_lesson_tutor_guard.sql"
  "backend/migrations/002_revenuecat_entitlements.sql"
  "backend/migrations/003_revenuecat_webhook_maintenance.sql"
)

checksum_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

"${psql_bin}" "${psql_args[@]}" --command="
SET ROLE cloudsqlsuperuser;
CREATE TABLE IF NOT EXISTS public.glidelingo_schema_migration (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL UNIQUE,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.glidelingo_schema_migration OWNER TO cloudsqlsuperuser;
REVOKE ALL ON public.glidelingo_schema_migration FROM PUBLIC, glidelingo_app;
"

temporary_files=()
cleanup() {
  if (( ${#temporary_files[@]} > 0 )); then
    rm -f -- "${temporary_files[@]}"
  fi
}
trap cleanup EXIT INT TERM

for index in "${!migration_files[@]}"; do
  version="$((index + 1))"
  relative_path="${migration_files[index]}"
  source_path="${root}/${relative_path}"
  name="$(basename "${relative_path}")"
  checksum="$(checksum_file "${source_path}")"
  state="$("${psql_bin}" "${psql_args[@]}" \
    --tuples-only --no-align \
    --set="migration_version=${version}" \
    --set="migration_name=${name}" \
    --set="migration_checksum=${checksum}" \
    --command="
SET ROLE cloudsqlsuperuser;
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM public.glidelingo_schema_migration WHERE version = :migration_version
  ) THEN 'missing'
  WHEN (
    SELECT checksum = :'migration_checksum' AND name = :'migration_name'
    FROM public.glidelingo_schema_migration
    WHERE version = :migration_version
  ) THEN 'applied'
  ELSE 'mismatch'
END;
" | tr -d '[:space:]')"

  case "${state}" in
    applied)
      continue
      ;;
    missing)
      ;;
    mismatch)
      echo "Migration ${version} is already recorded with a different checksum." >&2
      exit 1
      ;;
    *)
      echo "Migration ${version} returned an invalid durable state." >&2
      exit 1
      ;;
  esac

  transaction_file="$(mktemp "${TMPDIR:-/tmp}/glidelingo-migration-${version}.XXXXXX.sql")"
  temporary_files+=("${transaction_file}")
  chmod 600 "${transaction_file}"
  {
    printf '%s\n' '\set ON_ERROR_STOP on' 'BEGIN;' 'SET ROLE cloudsqlsuperuser;'
    sed -e '1{/^BEGIN;$/d;}' -e '${/^COMMIT;$/d;}' "${source_path}"
    printf '%s\n' \
      "INSERT INTO public.glidelingo_schema_migration (version, name, checksum)" \
      "VALUES (:migration_version, :'migration_name', :'migration_checksum');" \
      'COMMIT;'
  } > "${transaction_file}"

  "${psql_bin}" "${psql_args[@]}" \
    --set="migration_version=${version}" \
    --set="migration_name=${name}" \
    --set="migration_checksum=${checksum}" \
    --file="${transaction_file}"
done

echo "Production schema migrations are durably recorded and current."
