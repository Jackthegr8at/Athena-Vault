#!/bin/sh
set -eu

fail() {
  status=${1:-failed}
  failure_code=${2:-UNKNOWN}
  printf '{"event":"operational_failure","operation":"verify.restore","errorClass":"VerifyError","status":"%s","failureCode":"%s"}' "$status" "$failure_code" >&2
  printf '\n' >&2
}

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}
backup_name=${2:-}
target_suffix=${3:-}

if [ ! -f "$environment_file" ]; then
  fail 'failed' 'VERIFY_RESTORE_MISSING_ENVIRONMENT_FILE'
  exit 2
fi
if ! printf '%s' "$backup_name" | grep -Eq '^athena-vault-[A-Za-z0-9._-]+\.dump$'; then
  fail 'failed' 'VERIFY_RESTORE_INVALID_BACKUP_NAME'
  exit 3
fi
if ! printf '%s' "$target_suffix" | grep -Eq '^[a-z0-9][a-z0-9-]{0,31}$'; then
  fail 'failed' 'VERIFY_RESTORE_INVALID_TARGET_SUFFIX'
  exit 4
fi

backup_host_path=$(sed -n 's/^ATHENA_BACKUP_HOST_PATH=//p' "$environment_file" | tail -n 1 | tr -d '\r')
backup_host_path=$(printf '%s' "$backup_host_path" | sed 's/^"//;s/"$//')
if [ -z "$backup_host_path" ] || [ "${backup_host_path#/}" = "$backup_host_path" ]; then
  fail 'failed' 'VERIFY_RESTORE_ABSOLUTE_BACKUP_PATH_REQUIRED'
  exit 5
fi
if [ ! -f "$backup_host_path/$backup_name" ]; then
  fail 'failed' 'VERIFY_RESTORE_MISSING_BACKUP'
  exit 6
fi

project_name="athena-vault-verify-$target_suffix"
target_volume="athena-vault-verify-$target_suffix"
target_backup_volume="athena-vault-verify-$target_suffix-backups"
database_suffix=$(printf '%s' "$target_suffix" | tr '-' '_')
target_database="athena_vault_verify_$database_suffix"
migrator_database_url=$(sed -n 's/^ATHENA_MIGRATOR_DATABASE_URL=//p' "$environment_file" | tail -n 1 | tr -d '\r' | sed 's/^"//;s/"$//')
if ! target_migrator_url=$(printf '%s\n' "$migrator_database_url" | sed -E "s#(/)[^/?]+([?].*)?\$#\\1$target_database\\2#") ||
   [ "$target_migrator_url" = "$migrator_database_url" ]; then
  fail 'failed' 'VERIFY_RESTORE_INVALID_MIGRATOR_DATABASE_URL'
  exit 5
fi

if docker volume inspect "$target_volume" >/dev/null 2>&1; then
  fail 'failed' 'VERIFY_RESTORE_TARGET_VOLUME_EXISTS'
  exit 7
fi
if docker volume inspect "$target_backup_volume" >/dev/null 2>&1; then
  fail 'failed' 'VERIFY_RESTORE_TARGET_BACKUP_VOLUME_EXISTS'
  exit 7
fi
if ! projects="$(docker ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null)"; then
  fail 'failed' 'VERIFY_RESTORE_DOCKER_PROJECT_QUERY_FAILED'
  exit 8
fi
if printf '%s\n' "$projects" | grep -Fqx "$project_name"; then
  fail 'failed' 'VERIFY_RESTORE_TARGET_PROJECT_EXISTS'
  exit 8
fi

compose() {
  COMPOSE_PROJECT_NAME="$project_name" \
  ATHENA_DB_NAME="$target_database" \
  ATHENA_MIGRATOR_DATABASE_URL="$target_migrator_url" \
  ATHENA_PROD_POSTGRES_VOLUME_NAME="$target_volume" \
  ATHENA_PROD_BACKUP_VOLUME_NAME="$target_backup_volume" \
  ATHENA_PROD_INTERNAL_NETWORK_NAME="$project_name-internal" \
  ATHENA_PROD_EDGE_NETWORK_NAME="$project_name-edge" \
  ATHENA_PROD_CADDY_DATA_VOLUME_NAME="$project_name-caddy-data" \
  ATHENA_PROD_CADDY_CONFIG_VOLUME_NAME="$project_name-caddy-config" \
  docker compose --env-file "$environment_file" \
    -f "$project_root/docker-compose.yml" \
    -f "$project_root/docker-compose.prod.yml" "$@"
}

if compose up --detach --wait postgres >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'VERIFY_RESTORE_POSTGRES_START'
  exit "$rc"
fi

if ATHENA_RESTORE_CONFIRM=true \
   ATHENA_RESTORE_TARGET_DATABASE="$target_database" \
   ATHENA_RESTORE_TARGET_VOLUME="$target_volume" \
   compose run --rm \
     -e ATHENA_RESTORE_CONFIRM \
     -e ATHENA_RESTORE_TARGET_DATABASE \
     -e ATHENA_RESTORE_TARGET_VOLUME \
     db-tools "/usr/local/bin/restore-database.sh /backups/$backup_name" >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'VERIFY_RESTORE_RESTORE_FAILED'
  exit "$rc"
fi

if compose run --rm migrations ./packages/database/node_modules/.bin/tsx scripts/docker/verify-database.ts >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'VERIFY_RESTORE_DATABASE_CHECK_FAILED'
  exit "$rc"
fi

if compose down --volumes --remove-orphans >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'VERIFY_RESTORE_CLEANUP_FAILED'
  exit "$rc"
fi
# Compose can leave the explicitly named bind-backed backup volume object
# behind. Remove only this verifier-owned, validated name; the bind source and
# its backup files are not deleted by removing the Docker volume object.
if docker volume inspect "$target_backup_volume" >/dev/null 2>&1; then
  if ! docker volume rm "$target_backup_volume" >/dev/null 2>/dev/null; then
    fail 'failed' 'VERIFY_RESTORE_BACKUP_VOLUME_CLEANUP_FAILED'
    exit 9
  fi
fi
if docker volume inspect "$target_volume" >/dev/null 2>&1; then
  fail 'failed' 'VERIFY_RESTORE_TARGET_VOLUME_REMAINS'
  exit 9
fi
if docker volume inspect "$target_backup_volume" >/dev/null 2>&1; then
  fail 'failed' 'VERIFY_RESTORE_TARGET_BACKUP_VOLUME_REMAINS'
  exit 9
fi

echo "verify-restore=status=passed target=$target_database removed=true"
