-- The local restore intentionally uses --no-owner --no-privileges so the
-- archive is portable. Reconcile the local runtime boundary after restore.
-- This script changes ownership and ACLs only; it does not change any rows or
-- create/drop RLS policies.

DO $athena$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_migrator') THEN
    RAISE EXCEPTION 'athena_migrator role is required for a local restored database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_app') THEN
    RAISE EXCEPTION 'athena_app role is required for a local restored database';
  END IF;
END
$athena$;

ALTER SCHEMA public OWNER TO athena_migrator;
REVOKE CREATE ON SCHEMA public FROM athena_app;
GRANT USAGE ON SCHEMA public TO athena_app;

DO $athena$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT table_row.relname
    FROM pg_catalog.pg_class table_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND table_row.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO athena_migrator', table_name);
  END LOOP;
END
$athena$;

DO $athena$
DECLARE
  sequence_name text;
BEGIN
  FOR sequence_name IN
    SELECT sequence_row.relname
    FROM pg_catalog.pg_class sequence_row
    JOIN pg_catalog.pg_namespace namespace_row ON namespace_row.oid = sequence_row.relnamespace
    WHERE namespace_row.nspname = 'public'
      AND sequence_row.relkind = 'S'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO athena_migrator', sequence_name);
  END LOOP;
END
$athena$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO athena_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO athena_app;

REVOKE ALL ON TABLE public.auth_verifications FROM athena_app;
REVOKE ALL ON TABLE public.auth_rate_limits FROM athena_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.auth_users,
  public.auth_sessions,
  public.auth_accounts
TO athena_app;
GRANT SELECT, INSERT ON TABLE public.auth_user_workspaces TO athena_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.auth_invitations TO athena_app;

DO $athena$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_auth') THEN
    GRANT USAGE ON SCHEMA public TO athena_auth;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.auth_users,
      public.auth_sessions,
      public.auth_accounts,
      public.auth_verifications,
      public.auth_rate_limits
    TO athena_auth;
    IF to_regclass('public.auth_two_factors') IS NOT NULL THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_two_factors TO athena_auth';
    END IF;
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.auth_invitations,
      public.auth_user_workspaces
    TO athena_auth;
  END IF;
END
$athena$;

DO $athena$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    REVOKE DELETE ON TABLE public.users FROM athena_app;
  END IF;
  IF to_regclass('public.workspace_primary_owner') IS NOT NULL THEN
    REVOKE DELETE ON TABLE public.workspace_primary_owner FROM athena_app;
  END IF;
  IF to_regclass('public.rrq_year_limits') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.rrq_year_limits FROM athena_app;
    GRANT SELECT ON TABLE public.rrq_year_limits TO athena_app;
  END IF;
  IF to_regclass('public.auth_verifications') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.auth_verifications FROM athena_app;
  END IF;
  IF to_regclass('public.auth_rate_limits') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.auth_rate_limits FROM athena_app;
  END IF;
  IF to_regclass('public.auth_two_factors') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.auth_two_factors FROM athena_app;
  END IF;
END
$athena$;

ALTER DEFAULT PRIVILEGES FOR ROLE athena_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO athena_app;
ALTER DEFAULT PRIVILEGES FOR ROLE athena_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO athena_app;
