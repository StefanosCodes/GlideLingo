#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
runner="${root}/infra/gcp/scripts/run-versioned-production-migrations.sh"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/glidelingo-migration-runner-test.XXXXXX")"
fake_psql="${fixture_dir}/psql"
state_dir="${fixture_dir}/state"
mkdir "${state_dir}"
cleanup() { rm -rf -- "${fixture_dir}"; }
trap cleanup EXIT INT TERM

cat > "${fake_psql}" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${GLIDELINGO_MIGRATION_TEST_STATE:?}"
version=""
checksum=""
migration_file=""
command_sql=""
for argument in "$@"; do
  case "${argument}" in
    --set=migration_version=*) version="${argument#*=}" ;;
    --set=migration_checksum=*) checksum="${argument#*=}" ;;
    --file=*) migration_file="${argument#*=}" ;;
    --command=*) command_sql="${argument#*=}" ;;
  esac
done
if [[ "${command_sql}" == *"CREATE TABLE IF NOT EXISTS public.glidelingo_schema_migration"* ]]; then
  exit 0
fi
if [[ "${command_sql}" == *"SELECT CASE"* ]]; then
  if [[ -f "${state_dir}/${version}.applied" ]]; then
    if [[ "$(< "${state_dir}/${version}.applied")" == "${checksum}" ]]; then echo applied; else echo mismatch; fi
  else
    echo missing
  fi
  exit 0
fi
if [[ -n "${migration_file}" ]]; then
  grep -Fxq 'BEGIN;' "${migration_file}"
  test "$(tail -1 "${migration_file}")" = 'COMMIT;'
  insert_line="$(grep -n 'INSERT INTO public.glidelingo_schema_migration' "${migration_file}" | cut -d: -f1)"
  body_line="$(grep -n -m1 'CREATE TABLE\|DO \$\$' "${migration_file}" | cut -d: -f1)"
  test "${insert_line}" -gt "${body_line}"
  if [[ ! -f "${state_dir}/interrupted-once" ]]; then
    touch "${state_dir}/interrupted-once"
    exit 99
  fi
  printf '%s' "${checksum}" > "${state_dir}/${version}.applied"
  printf '%s\n' "${version}" >> "${state_dir}/apply-log"
  exit 0
fi
echo "Unexpected fake psql invocation." >&2
exit 2
FAKE
chmod +x "${fake_psql}"

run_fixture() {
  GLIDELINGO_PSQL_BIN="${fake_psql}" \
  GLIDELINGO_MIGRATION_TEST_STATE="${state_dir}" \
  GLIDELINGO_MIGRATION_USER=fixture_operator \
    "${runner}"
}

if run_fixture >/dev/null 2>&1; then
  echo "The first migration run should simulate an interruption." >&2
  exit 1
fi
if find "${state_dir}" -name '*.applied' -print -quit | grep -q .; then
  echo "An interrupted transaction must not durably mark a migration applied." >&2
  exit 1
fi

run_fixture >/dev/null
test "$(wc -l < "${state_dir}/apply-log" | tr -d ' ')" = "3"
before="$(< "${state_dir}/apply-log")"
run_fixture >/dev/null
test "$(< "${state_dir}/apply-log")" = "${before}"

echo "Versioned migration interruption, resume, and no-op replay contracts passed."
