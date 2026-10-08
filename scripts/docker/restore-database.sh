#!/bin/sh
set -eu

fail() {
  status=${1:-failed}
  failure_code=${2:-UNKNOWN}
  printf '{"event":"operational_failure","operation":"restore.database","errorClass":"RestoreError","status":"%s","failureCode":"%s"}' "$status" "$failure_code" >&2
  printf '\n' >&2
}

restore_path="${1:-}"
if [ -z "$restore_path" ] || [ ! -f "$restore_path" ]; then
  fail 'failed' 'RESTORE_MISSING_DUMP'
  exit 2
fi

if [ -z "${PGHOST:-}" ] || [ -z "${PGPORT:-}" ] || [ -z "${PGDATABASE:-}" ] ||
   [ -z "${PGUSER:-}" ] || [ -z "${PGPASSWORD:-}" ] ||
   [ -z "${ATHENA_DB_PASSWORD:-}" ] || [ -z "${ATHENA_AUTH_ROLE_PASSWORD:-}" ] ||
   [ -z "${ATHENA_RESTORE_CONFIRM:-}" ] || [ -z "${ATHENA_RESTORE_TARGET_DATABASE:-}" ] ||
   [ -z "${ATHENA_RESTORE_TARGET_VOLUME:-}" ]; then
  fail 'failed' 'RESTORE_REQUIRED_CONFIGURATION'
  exit 2
fi

if [ "$ATHENA_RESTORE_CONFIRM" != "true" ]; then
  fail 'failed' 'RESTORE_CONFIRMATION_REQUIRED'
  exit 3
fi
if [ "$ATHENA_RESTORE_TARGET_DATABASE" != "$PGDATABASE" ] || ! printf '%s' "$PGDATABASE" | grep -Eq '^[a-z][a-z0-9_]{0,62}$'; then
  fail 'failed' 'RESTORE_INVALID_TARGET_DATABASE'
  exit 4
fi
case "$ATHENA_RESTORE_TARGET_VOLUME" in
  athena-vault-dev-*|athena-vault-verify-*) ;;
  athena-vault-prod-*)
    if [ -z "${ATHENA_RESTORE_ALLOW_PRODUCTION:-}" ] || [ -z "${ATHENA_RESTORE_PRODUCTION_CONFIRM:-}" ]; then
      fail 'failed' 'RESTORE_PRODUCTION_CONFIGURATION'
      exit 6
    fi
    if [ "$ATHENA_RESTORE_ALLOW_PRODUCTION" != "true" ] || [ "$ATHENA_RESTORE_PRODUCTION_CONFIRM" != "$PGDATABASE:$ATHENA_RESTORE_TARGET_VOLUME" ]; then
      fail 'failed' 'RESTORE_PRODUCTION_TARGET_REFUSED'
      exit 6
    fi
    ;;
  *)
    fail 'failed' 'RESTORE_INVALID_TARGET_VOLUME'
    exit 5
    ;;
esac
if ! public_tables="$(psql -X -v ON_ERROR_STOP=1 -Atqc "select count(*) from pg_catalog.pg_tables where schemaname = 'public';" 2>/dev/null)"; then
  fail 'failed' 'RESTORE_TARGET_QUERY_FAILED'
  exit 7
fi
if [ "$public_tables" != "0" ]; then
  fail 'failed' 'RESTORE_TARGET_NOT_EMPTY'
  exit 7
fi

if ! psql -X -v ON_ERROR_STOP=1 "$PGDATABASE" >/dev/null 2>/dev/null <<'SQL'
\getenv app_password ATHENA_DB_PASSWORD
\getenv auth_password ATHENA_AUTH_ROLE_PASSWORD
SELECT set_config('app.athena_app_password', :'app_password', false);
SELECT set_config('app.athena_auth_password', :'auth_password', false);
DO $$
DECLARE
  app_password text := current_setting('app.athena_app_password', true);
  auth_password text := current_setting('app.athena_auth_password', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'restore role bootstrap requires a superuser connection';
  END IF;
  IF app_password IS NULL OR app_password = '' OR auth_password IS NULL OR auth_password = '' THEN
    RAISE EXCEPTION 'runtime role passwords are required';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_app') THEN
    EXECUTE format('ALTER ROLE athena_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', app_password);
  ELSE
    EXECUTE format('CREATE ROLE athena_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', app_password);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'athena_auth') THEN
    EXECUTE format('ALTER ROLE athena_auth WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', auth_password);
  ELSE
    EXECUTE format('CREATE ROLE athena_auth WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', auth_password);
  END IF;
END
$$;
SQL
then
  fail 'failed' 'RESTORE_RUNTIME_ROLE_BOOTSTRAP_FAILED'
  exit 8
fi

if ! pg_restore --exit-on-error --no-owner --dbname="$PGDATABASE" "$restore_path" >/dev/null 2>/dev/null; then
  fail 'failed' 'RESTORE_EXECUTION_FAILED'
  exit 8
fi
if ! restored_tables="$(psql -X -v ON_ERROR_STOP=1 -Atqc "select count(*) from pg_catalog.pg_tables where schemaname = 'public';" 2>/dev/null)"; then
  fail 'failed' 'RESTORE_RESULT_QUERY_FAILED'
  exit 8
fi
if ! printf '%s' "$restored_tables" | grep -Eq '^[0-9]+$'; then
  fail 'failed' 'RESTORE_RESULT_COUNT_INVALID'
  exit 8
fi
if [ "$restored_tables" -le 0 ]; then
  fail 'failed' 'RESTORE_NO_SCHEMA_RESTORED'
  exit 8
fi

echo "restore=status=complete target=$ATHENA_RESTORE_TARGET_DATABASE volume=$ATHENA_RESTORE_TARGET_VOLUME tables=$restored_tables"
