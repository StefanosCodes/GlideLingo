BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'glidelingo_revenuecat_maintenance'
  ) THEN
    CREATE ROLE glidelingo_revenuecat_maintenance
      LOGIN
      PASSWORD NULL
      CONNECTION LIMIT 1
      NOINHERIT
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  ELSE
    ALTER ROLE glidelingo_revenuecat_maintenance
      LOGIN
      PASSWORD NULL
      CONNECTION LIMIT 1
      NOINHERIT
      NOCREATEDB
      NOCREATEROLE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'glidelingo_revenuecat_maintenance'
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
        OR rolbypassrls
        OR NOT rolcanlogin
        OR rolinherit
        OR rolconnlimit <> 1
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_auth_members
    WHERE member = 'glidelingo_revenuecat_maintenance'::regrole
       OR (
         roleid = 'glidelingo_revenuecat_maintenance'::regrole
         AND member <> 'cloudsqlsuperuser'::regrole
       )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_auth_members
    WHERE roleid = 'glidelingo_revenuecat_maintenance'::regrole
      AND member = 'cloudsqlsuperuser'::regrole
      AND admin_option
  ) THEN
    RAISE EXCEPTION
      'glidelingo_revenuecat_maintenance has unexpected role memberships';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM glidelingo_revenuecat_maintenance',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO glidelingo_revenuecat_maintenance',
    current_database()
  );
END
$$;

REVOKE ALL PRIVILEGES ON SCHEMA public
  FROM glidelingo_revenuecat_maintenance;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM glidelingo_revenuecat_maintenance;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM glidelingo_revenuecat_maintenance;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public
  FROM glidelingo_revenuecat_maintenance;

GRANT USAGE ON SCHEMA public TO glidelingo_revenuecat_maintenance;
GRANT SELECT, DELETE ON revenuecat_webhook_event
  TO glidelingo_revenuecat_maintenance;

CREATE OR REPLACE PROCEDURE prune_revenuecat_webhook_events()
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  WITH expired AS (
    SELECT event_id
    FROM public.revenuecat_webhook_event
    WHERE processed_at < now() - interval '30 days'
    ORDER BY processed_at
    LIMIT 1000
  )
  DELETE FROM public.revenuecat_webhook_event AS webhook
  USING expired
  WHERE webhook.event_id = expired.event_id;
END;
$$;

ALTER PROCEDURE prune_revenuecat_webhook_events() OWNER TO cloudsqlsuperuser;
REVOKE ALL ON PROCEDURE prune_revenuecat_webhook_events() FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE prune_revenuecat_webhook_events()
  TO glidelingo_revenuecat_maintenance;

COMMIT;
