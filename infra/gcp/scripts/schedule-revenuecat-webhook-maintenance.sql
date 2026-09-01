\set ON_ERROR_STOP on

SELECT current_user = 'cloudsqlsuperuser' AS owner_role_active,
       session_user <> 'glidelingo_app' AS separate_operator_active
\gset

\if :owner_role_active
\else
  \echo 'schedule refused: SET ROLE cloudsqlsuperuser must be active'
  \quit 3
\endif

\if :separate_operator_active
\else
  \echo 'schedule refused: glidelingo_app cannot run operator SQL'
  \quit 3
\endif

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT pg_get_userbyid(extowner) = 'cloudsqlsuperuser' AS extension_owner_is_safe
FROM pg_extension
WHERE extname = 'pg_cron'
\gset

\if :extension_owner_is_safe
\else
  \echo 'schedule refused: pg_cron extension owner is not cloudsqlsuperuser'
  \quit 3
\endif

SELECT count(*) = 0 AS no_foreign_job
FROM cron.job
WHERE jobname = 'glidelingo-revenuecat-webhook-retention'
  AND username <> 'glidelingo_revenuecat_maintenance'
\gset

\if :no_foreign_job
\else
  \echo 'schedule refused: same-named cron job exists under another database role'
  \quit 3
\endif

GRANT USAGE ON SCHEMA cron TO glidelingo_revenuecat_maintenance;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text)
  TO glidelingo_revenuecat_maintenance;
GRANT EXECUTE ON FUNCTION cron.unschedule(bigint)
  TO glidelingo_revenuecat_maintenance;

GRANT glidelingo_revenuecat_maintenance TO SESSION_USER;
SET ROLE glidelingo_revenuecat_maintenance;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'glidelingo-revenuecat-webhook-retention';

SELECT cron.schedule(
  'glidelingo-revenuecat-webhook-retention',
  '17 * * * *',
  'CALL public.prune_revenuecat_webhook_events()'
);

RESET ROLE;
SET ROLE cloudsqlsuperuser;
REVOKE glidelingo_revenuecat_maintenance FROM SESSION_USER;

SELECT count(*) = 0 AS maintenance_memberships_removed
FROM pg_auth_members
WHERE member = 'glidelingo_revenuecat_maintenance'::regrole
   OR roleid = 'glidelingo_revenuecat_maintenance'::regrole
\gset

\if :maintenance_memberships_removed
\else
  \echo 'schedule refused: temporary maintenance-role membership remains'
  \quit 3
\endif

SELECT count(*) = 1 AS scheduled_job_is_exact
FROM cron.job
WHERE jobname = 'glidelingo-revenuecat-webhook-retention'
  AND schedule = '17 * * * *'
  AND database = current_database()
  AND username = 'glidelingo_revenuecat_maintenance'
  AND command = 'CALL public.prune_revenuecat_webhook_events()'
  AND active
\gset

\if :scheduled_job_is_exact
\else
  \echo 'schedule refused: resulting cron job contract is not exact'
  \quit 3
\endif

COMMIT;
