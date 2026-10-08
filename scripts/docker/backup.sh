#!/bin/sh
set -eu

fail() {
  status=${1:-failed}
  failure_code=${2:-UNKNOWN}
  printf '{"event":"operational_failure","operation":"backup.run","errorClass":"BackupError","status":"%s","failureCode":"%s"}' "$status" "$failure_code" >&2
  printf '\n' >&2
}

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}
requested_name=${2:-}

if [ ! -f "$environment_file" ]; then
  fail 'failed' 'BACKUP_MISSING_ENVIRONMENT_FILE'
  exit 2
fi

if [ -n "$requested_name" ]; then
  backup_name=$requested_name
else
  if ! timestamp=$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null); then
    fail 'failed' 'BACKUP_TIMESTAMP'
    exit 3
  fi
  backup_name="athena-vault-$timestamp.dump"
fi

if ! printf '%s' "$backup_name" | grep -Eq '^athena-vault-[A-Za-z0-9._-]+\.dump$'; then
  fail 'failed' 'BACKUP_INVALID_BACKUP_NAME'
  exit 3
fi

backup_host_path=$(sed -n 's/^ATHENA_BACKUP_HOST_PATH=//p' "$environment_file" | tail -n 1 | tr -d '\r')
backup_host_path=$(printf '%s' "$backup_host_path" | sed 's/^"//;s/"$//')
if [ -z "$backup_host_path" ] || [ "${backup_host_path#/}" = "$backup_host_path" ]; then
  fail 'failed' 'BACKUP_ABSOLUTE_BACKUP_PATH_REQUIRED'
  exit 4
fi
if [ ! -d "$backup_host_path" ] || [ ! -w "$backup_host_path" ]; then
  fail 'failed' 'BACKUP_BACKUP_DIRECTORY_UNAVAILABLE'
  exit 5
fi
if [ -e "$backup_host_path/$backup_name" ]; then
  fail 'failed' 'BACKUP_BACKUP_EXISTS'
  exit 6
fi

backup_owner_uid=$(id -u)
backup_owner_gid=$(id -g)
if ! printf '%s\n' "$backup_owner_uid" | grep -Eq '^[0-9]+$' ||
   ! printf '%s\n' "$backup_owner_gid" | grep -Eq '^[0-9]+$'; then
  fail 'failed' 'BACKUP_INVALID_BACKUP_OWNER'
  exit 8
fi

compose() {
  docker compose --env-file "$environment_file" \
    -f "$project_root/docker-compose.yml" \
    -f "$project_root/docker-compose.prod.yml" "$@"
}

if compose up --detach --wait postgres >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'BACKUP_POSTGRES_START'
  exit "$rc"
fi
if compose run --rm db-tools "
  set -eu
  final='/backups/$backup_name'
  temporary=\"\$final.partial\"
  if [ -e \"\$final\" ] || [ -e \"\$temporary\" ]; then
    printf '%s\n' '{"event":"operational_failure","operation":"backup.run","errorClass":"BackupError","status":"failed","failureCode":"BACKUP_BACKUP_EXISTS"}' >&2
    exit 6
  fi
  trap 'rm -f \"\$temporary\"' EXIT HUP INT TERM
  pg_dump --format=custom --compress=9 --no-owner --file=\"\$temporary\"
  chmod 600 \"\$temporary\"
  mv \"\$temporary\" \"\$final\"
  chown '$backup_owner_uid:$backup_owner_gid' \"\$final\"
  chmod 600 \"\$final\"
  trap - EXIT HUP INT TERM
" >/dev/null 2>/dev/null; then
  :
else
  rc=$?
  fail 'failed' 'BACKUP_COMPOSE_RUN'
  exit "$rc"
fi

if [ ! -f "$backup_host_path/$backup_name" ] ||
   [ ! -s "$backup_host_path/$backup_name" ] ||
   [ ! -r "$backup_host_path/$backup_name" ]; then
  fail 'failed' 'BACKUP_BACKUP_UNREADABLE_OR_EMPTY'
  exit 7
fi

if ! backup_bytes=$(wc -c < "$backup_host_path/$backup_name" 2>/dev/null); then
  fail 'failed' 'BACKUP_BACKUP_BYTE_COUNT_UNAVAILABLE'
  exit 9
fi
backup_bytes=$(printf '%s' "$backup_bytes" | tr -d '[:space:]')
if ! printf '%s\n' "$backup_bytes" | grep -Eq '^[1-9][0-9]*$'; then
  fail 'failed' 'BACKUP_INVALID_BACKUP_BYTE_COUNT'
  exit 9
fi

if ! backup_sha256=$(sha256sum "$backup_host_path/$backup_name" 2>/dev/null | awk '{print $1}'); then
  fail 'failed' 'BACKUP_BACKUP_CHECKSUM_UNAVAILABLE'
  exit 10
fi
if ! printf '%s\n' "$backup_sha256" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  fail 'failed' 'BACKUP_INVALID_BACKUP_CHECKSUM'
  exit 10
fi

echo "backup=status=complete file=$backup_name bytes=$backup_bytes sha256=$backup_sha256"
