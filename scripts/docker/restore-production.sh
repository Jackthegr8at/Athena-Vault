#!/bin/sh
set -eu

fail() {
  status=${1:-failed}
  failure_code=${2:-UNKNOWN}
  printf '{"event":"operational_failure","operation":"restore.production","errorClass":"RestoreError","status":"%s","failureCode":"%s"}' "$status" "$failure_code" >&2
  printf '\n' >&2
}

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}
backup_name=${2:-}
confirmation=${3:-}

if [ ! -f "$environment_file" ]; then
  fail 'failed' 'RESTORE_PRODUCTION_MISSING_ENVIRONMENT_FILE'
  exit 2
fi
if ! printf '%s' "$backup_name" | grep -Eq '^athena-vault-[A-Za-z0-9._-]+\.dump$'; then
  fail 'failed' 'RESTORE_PRODUCTION_INVALID_BACKUP_NAME'
  exit 3
fi
if [ "$confirmation" != "RESTORE_NEW_PRODUCTION_VOLUME" ]; then
  fail 'failed' 'RESTORE_PRODUCTION_CONFIRMATION_REQUIRED'
  exit 4
fi

read_value() {
  sed -n "s/^$1=//p" "$environment_file" | tail -n 1 | tr -d '\r' | sed 's/^"//;s/"$//'
}

backup_host_path=$(read_value ATHENA_BACKUP_HOST_PATH)
target_database=$(read_value ATHENA_DB_NAME)
target_volume=$(read_value ATHENA_PROD_POSTGRES_VOLUME_NAME)
migrator_database_url=$(read_value ATHENA_MIGRATOR_DATABASE_URL)
target_database=${target_database:-athena_vault}
target_volume=${target_volume:-athena-vault-prod-postgres}

if [ -z "$backup_host_path" ] || [ "${backup_host_path#/}" = "$backup_host_path" ] || [ ! -f "$backup_host_path/$backup_name" ]; then
  fail 'failed' 'RESTORE_PRODUCTION_MISSING_BACKUP'
  exit 5
fi
if ! printf '%s' "$target_database" | grep -Eq '^[a-z][a-z0-9_]{0,62}$'; then
  fail 'failed' 'RESTORE_PRODUCTION_INVALID_TARGET_DATABASE'
  exit 6
fi
if ! target_migrator_url=$(printf '%s\n' "$migrator_database_url" | sed -E "s#(/)[^/?]+([?].*)?\$#\\1$target_database\\2#") ||
   [ "$target_migrator_url" = "$migrator_database_url" ]; then
  fail 'failed' 'RESTORE_PRODUCTION_INVALID_MIGRATOR_DATABASE_URL'
  exit 6
fi
if ! printf '%s' "$target_volume" | grep -Eq '^athena-vault-prod-[a-z0-9-]+$'; then
  fail 'failed' 'RESTORE_PRODUCTION_INVALID_TARGET_VOLUME'
  exit 7
fi
if docker volume inspect "$target_volume" >/dev/null 2>&1; then
  fail 'failed' 'RESTORE_PRODUCTION_TARGET_VOLUME_EXISTS'
  exit 8
fi

compose() {
  ATHENA_MIGRATOR_DATABASE_URL="$target_migrator_url" \
  docker compose --env-file "$environment_file" \
    -f "$project_root/docker-compose.yml" \
    -f "$project_root/docker-compose.prod.yml" "$@"
}

if compose up --detach --wait postgres >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'RESTORE_PRODUCTION_POSTGRES_START'
  exit "$rc"
fi

if ATHENA_RESTORE_CONFIRM=true \
   ATHENA_RESTORE_TARGET_DATABASE="$target_database" \
   ATHENA_RESTORE_TARGET_VOLUME="$target_volume" \
   ATHENA_RESTORE_ALLOW_PRODUCTION=true \
   ATHENA_RESTORE_PRODUCTION_CONFIRM="$target_database:$target_volume" \
   compose run --rm \
     -e ATHENA_RESTORE_CONFIRM \
     -e ATHENA_RESTORE_TARGET_DATABASE \
     -e ATHENA_RESTORE_TARGET_VOLUME \
     -e ATHENA_RESTORE_ALLOW_PRODUCTION \
     -e ATHENA_RESTORE_PRODUCTION_CONFIRM \
     db-tools "/usr/local/bin/restore-database.sh /backups/$backup_name" >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'RESTORE_PRODUCTION_RESTORE_FAILED'
  exit "$rc"
fi

if compose run --rm migrations ./packages/database/node_modules/.bin/tsx scripts/docker/verify-database.ts >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'RESTORE_PRODUCTION_VERIFY_FAILED'
  exit "$rc"
fi
if compose run --rm migrations >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'RESTORE_PRODUCTION_MIGRATION_FAILED'
  exit "$rc"
fi
if compose run --rm migrations >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'RESTORE_PRODUCTION_MIGRATION_FAILED'
  exit "$rc"
fi
if compose run --rm migrations ./packages/database/node_modules/.bin/tsx scripts/docker/verify-database.ts >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'RESTORE_PRODUCTION_VERIFY_FAILED'
  exit "$rc"
fi

echo "restore-production=status=complete database=$target_database volume=$target_volume migrations=verified-twice"
