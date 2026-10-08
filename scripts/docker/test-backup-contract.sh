#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
backup_script="$project_root/scripts/docker/backup.sh"
restore_verifier="$project_root/scripts/docker/verify-restore.sh"

require_literal() {
  pattern=$1
  description=$2
  if ! grep -Fq "$pattern" "$backup_script"; then
    echo "backup-contract=failed missing=$description" >&2
    exit 1
  fi
}

sh -n "$backup_script"
sh -n "$restore_verifier"
require_literal 'backup_owner_uid=$(id -u)' 'host-uid-capture'
require_literal 'backup_owner_gid=$(id -g)' 'host-gid-capture'
require_literal "grep -Eq '^[0-9]+$'" 'numeric-owner-validation'
require_literal '$backup_owner_uid:$backup_owner_gid' 'final-owner-assignment'
require_literal 'chmod 600 \"\$final\"' 'final-private-mode'
require_literal '[ ! -r "$backup_host_path/$backup_name" ]' 'host-readability-gate'
require_literal 'BACKUP_BACKUP_BYTE_COUNT_UNAVAILABLE' 'byte-count-failure'
require_literal 'BACKUP_INVALID_BACKUP_BYTE_COUNT' 'byte-count-validation'
require_literal 'BACKUP_BACKUP_CHECKSUM_UNAVAILABLE' 'checksum-failure'
require_literal 'BACKUP_INVALID_BACKUP_CHECKSUM' 'checksum-validation'

if ! grep -Fq 'docker volume rm "$target_backup_volume"' "$restore_verifier"; then
  echo 'backup-contract=failed missing=disposable-bind-volume-cleanup' >&2
  exit 1
fi

echo 'backup-contract=status=passed'
