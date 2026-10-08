#!/bin/sh
set -eu

fail() {
  status=${1:-failed}
  failure_code=${2:-UNKNOWN}
  printf '{"event":"operational_failure","operation":"backup.scheduled","errorClass":"BackupError","status":"%s","failureCode":"%s"}' "$status" "$failure_code" >&2
  printf '\n' >&2
}

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${1:-"$project_root/.env.docker.prod"}

if [ ! -f "$environment_file" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_MISSING_ENVIRONMENT_FILE'
  exit 2
fi

read_value() {
  name=$1
  value=$(sed -n "s/^${name}=//p" "$environment_file" | tail -n 1 | tr -d '\r')
  printf '%s' "$value" | sed 's/^"//;s/"$//'
}

backup_host_path=$(read_value ATHENA_BACKUP_HOST_PATH)
if [ -z "$backup_host_path" ] || [ "${backup_host_path#/}" = "$backup_host_path" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_ABSOLUTE_BACKUP_PATH_REQUIRED'
  exit 3
fi
if [ ! -d "$backup_host_path" ] || [ ! -w "$backup_host_path" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_BACKUP_DIRECTORY_UNAVAILABLE'
  exit 4
fi

encryption_recipient=$(read_value ATHENA_BACKUP_ENCRYPTION_RECIPIENT)
if [ -z "$encryption_recipient" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_MISSING_ENCRYPTION_RECIPIENT'
  exit 5
fi

compose() {
  # The protected env file is authoritative. Do not let an empty or stale
  # ambient ATHENA_*/COMPOSE_* variable override a value from that file.
  env -i \
    "PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
    "HOME=${HOME:-/root}" \
    docker compose \
    --env-file "$environment_file" \
    -f "$project_root/docker-compose.yml" \
    -f "$project_root/docker-compose.prod.yml" \
    --profile scheduled-backup "$@"
}

if ! compose run --rm --no-deps scheduled-backup >/dev/null 2>/dev/null; then
  fail 'failed' 'SCHEDULED_BACKUP_COMPOSE_RUN'
  exit 6
fi
