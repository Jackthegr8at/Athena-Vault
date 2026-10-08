#!/bin/sh
set -eu

fail() {
  status=${1:-failed}
  failure_code=${2:-UNKNOWN}
  printf '{"event":"operational_failure","operation":"backup.scheduled","errorClass":"BackupError","status":"%s","failureCode":"%s"}' "$status" "$failure_code" >&2
  printf '\n' >&2
}

if [ -z "${PGHOST:-}" ] || [ -z "${PGPORT:-}" ] || [ -z "${PGDATABASE:-}" ] ||
   [ -z "${PGUSER:-}" ] || [ -z "${PGPASSWORD:-}" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_DATABASE_CONFIGURATION'
  exit 2
fi

backup_directory=${ATHENA_BACKUP_DIRECTORY:-/backups}
encryption_recipient=${ATHENA_BACKUP_ENCRYPTION_RECIPIENT:-}
retention_days=${ATHENA_BACKUP_RETENTION_DAYS:-30}
retention_count=${ATHENA_BACKUP_RETENTION_COUNT:-14}

log() {
  printf 'scheduled-backup=%s\n' "$*"
}

positive_integer() {
  value=$1
  printf '%s\n' "$value" | grep -Eq '^[1-9][0-9]*$'
}

if [ -z "$encryption_recipient" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_MISSING_ENCRYPTION_RECIPIENT'
  exit 2
fi
if ! printf '%s\n' "$retention_days" | grep -Eq '^[0-9]+$'; then
  fail 'failed' 'SCHEDULED_BACKUP_INVALID_RETENTION_DAYS'
  exit 3
fi
if ! positive_integer "$retention_count"; then
  fail 'failed' 'SCHEDULED_BACKUP_INVALID_RETENTION_COUNT'
  exit 4
fi
if [ ! -d "$backup_directory" ] || [ ! -w "$backup_directory" ]; then
  fail 'failed' 'SCHEDULED_BACKUP_BACKUP_DIRECTORY_UNAVAILABLE'
  exit 5
fi

# Every owner-scoped table uses FORCE ROW LEVEL SECURITY.  A dump made by a
# role that cannot bypass RLS can succeed while silently containing no
# financial rows, so fail closed before creating an artifact.
if ! backup_role_can_bypass_rls=$(psql -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT CASE WHEN rolsuper OR rolbypassrls THEN 't' ELSE 'f' END FROM pg_catalog.pg_roles WHERE rolname = current_user;" \
  2>/dev/null); then
  fail 'failed' 'SCHEDULED_BACKUP_BACKUP_ROLE_CHECK'
  exit 6
fi
if [ "$backup_role_can_bypass_rls" != 't' ]; then
  fail 'failed' 'SCHEDULED_BACKUP_BACKUP_ROLE_NOT_RLS_CAPABLE'
  exit 7
fi

prune_backups() {
  if ! find "$backup_directory" -maxdepth 1 -type f \
    -name 'athena-vault-scheduled-*.dump.age' \
    -mtime "+$retention_days" -delete 2>/dev/null; then
    fail 'failed' 'SCHEDULED_BACKUP_RETENTION_PRUNE'
    return 1
  fi

  set -- $(ls -1t "$backup_directory"/athena-vault-scheduled-*.dump.age 2>/dev/null || true)
  while [ "$#" -gt "$retention_count" ]; do
    if ! rm -f -- "$1" 2>/dev/null; then
      fail 'failed' 'SCHEDULED_BACKUP_RETENTION_DELETE'
      return 1
    fi
    shift
  done
}

create_backup() {
  if ! timestamp=$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null); then
    fail 'failed' 'SCHEDULED_BACKUP_TIMESTAMP'
    return 1
  fi
  output="$backup_directory/athena-vault-scheduled-$timestamp.dump.age"
  temporary_dump="/tmp/athena-vault-scheduled-$timestamp.dump"
  temporary_output="$output.partial"

  if [ -e "$output" ] || [ -e "$temporary_dump" ] || [ -e "$temporary_output" ]; then
    fail 'failed' 'SCHEDULED_BACKUP_BACKUP_EXISTS'
    return 1
  fi

  cleanup() {
    rm -f -- "$temporary_dump" "$temporary_output" 2>/dev/null || true
  }
  trap cleanup EXIT HUP INT TERM

  if ! pg_dump --format=custom --compress=9 --no-owner --file="$temporary_dump" 2>/dev/null; then
    cleanup
    trap - EXIT HUP INT TERM
    fail 'failed' 'SCHEDULED_BACKUP_PG_DUMP'
    return 1
  fi
  if ! chmod 600 "$temporary_dump" 2>/dev/null; then
    cleanup
    trap - EXIT HUP INT TERM
    fail 'failed' 'SCHEDULED_BACKUP_TEMPORARY_PERMISSIONS'
    return 1
  fi
  if ! age -r "$encryption_recipient" -o "$temporary_output" "$temporary_dump" 2>/dev/null; then
    cleanup
    trap - EXIT HUP INT TERM
    fail 'failed' 'SCHEDULED_BACKUP_ENCRYPTION'
    return 1
  fi
  if ! chmod 600 "$temporary_output" 2>/dev/null; then
    cleanup
    trap - EXIT HUP INT TERM
    fail 'failed' 'SCHEDULED_BACKUP_ENCRYPTED_PERMISSIONS'
    return 1
  fi
  if ! mv -- "$temporary_output" "$output" 2>/dev/null; then
    cleanup
    trap - EXIT HUP INT TERM
    fail 'failed' 'SCHEDULED_BACKUP_BACKUP_FINALIZE'
    return 1
  fi
  if ! chmod 600 "$output" 2>/dev/null; then
    fail 'failed' 'SCHEDULED_BACKUP_FINAL_PERMISSIONS'
    return 1
  fi
  trap - EXIT HUP INT TERM
  cleanup

  if ! bytes=$(wc -c < "$output" 2>/dev/null | tr -d '[:space:]'); then
    fail 'failed' 'SCHEDULED_BACKUP_BYTE_COUNT'
    return 1
  fi
  if ! sha256=$(sha256sum "$output" 2>/dev/null | awk '{print $1}'); then
    fail 'failed' 'SCHEDULED_BACKUP_CHECKSUM'
    return 1
  fi
  log "status=complete file=$(basename "$output") bytes=$bytes sha256=$sha256"
}

if create_backup; then
  if ! prune_backups; then
    fail 'failed' 'SCHEDULED_BACKUP_RETENTION_FAILED'
    exit 1
  fi
else
  fail 'failed' 'SCHEDULED_BACKUP_BACKUP_COMMAND'
  exit 1
fi
