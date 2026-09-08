#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
compose_file="${root}/infra/compose.yaml"
expected_confirmation="glidelingo-local"

if [[ "${1:-}" != "--confirm" || "${2:-}" != "${expected_confirmation}" || $# -ne 2 ]]; then
  echo "Usage: npm run db:reset:local -- --confirm ${expected_confirmation}" >&2
  exit 1
fi
for command in docker; do
  command -v "${command}" >/dev/null 2>&1 || { echo "${command} is required." >&2; exit 1; }
done

docker compose -f "${compose_file}" up -d --wait db
docker compose -f "${compose_file}" exec -T db \
  psql -X -U glidelingo -d glidelingo -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $reset$
DECLARE
  before_count bigint;
  after_count bigint;
BEGIN
  IF to_regclass('public.lesson_tutor_turn_guard') IS NULL THEN
    RAISE NOTICE 'lesson_tutor_turn_guard: absent (already clean)';
  ELSE
    LOCK TABLE public.lesson_tutor_turn_guard IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO before_count FROM public.lesson_tutor_turn_guard;
    DELETE FROM public.lesson_tutor_turn_guard;
    SELECT count(*) INTO after_count FROM public.lesson_tutor_turn_guard;
    IF after_count <> 0 THEN RAISE EXCEPTION 'lesson_tutor_turn_guard reset failed'; END IF;
    RAISE NOTICE 'lesson_tutor_turn_guard: % -> %', before_count, after_count;
  END IF;

  IF to_regclass('public.revenuecat_webhook_event') IS NULL THEN
    RAISE NOTICE 'revenuecat_webhook_event: absent (already clean)';
  ELSE
    LOCK TABLE public.revenuecat_webhook_event IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO before_count FROM public.revenuecat_webhook_event;
    DELETE FROM public.revenuecat_webhook_event;
    SELECT count(*) INTO after_count FROM public.revenuecat_webhook_event;
    IF after_count <> 0 THEN RAISE EXCEPTION 'revenuecat_webhook_event reset failed'; END IF;
    RAISE NOTICE 'revenuecat_webhook_event: % -> %', before_count, after_count;
  END IF;

  IF to_regclass('public.revenuecat_entitlement_state') IS NULL THEN
    RAISE NOTICE 'revenuecat_entitlement_state: absent (already clean)';
  ELSE
    LOCK TABLE public.revenuecat_entitlement_state IN ACCESS EXCLUSIVE MODE;
    SELECT count(*) INTO before_count FROM public.revenuecat_entitlement_state;
    DELETE FROM public.revenuecat_entitlement_state;
    SELECT count(*) INTO after_count FROM public.revenuecat_entitlement_state;
    IF after_count <> 0 THEN RAISE EXCEPTION 'revenuecat_entitlement_state reset failed'; END IF;
    RAISE NOTICE 'revenuecat_entitlement_state: % -> %', before_count, after_count;
  END IF;
END
$reset$;
COMMIT;
SQL

echo "Local GlideLingo application tables are empty; the Docker volume and schema were preserved."
