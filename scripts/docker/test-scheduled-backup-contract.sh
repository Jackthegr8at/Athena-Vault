#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file="$project_root/docker-compose.prod.yml"
dockerfile="$project_root/Dockerfile.db-tools"
backup_script="$project_root/scripts/docker/scheduled-backup.sh"
compose_preflight="$project_root/scripts/docker/verify-compose-private-https.py"
scheduled_runner="$project_root/scripts/docker/run-scheduled-backup.sh"
systemd_service="$project_root/infrastructure/systemd/athena-vault-scheduled-backup.service"
systemd_timer="$project_root/infrastructure/systemd/athena-vault-scheduled-backup.timer"

fail() {
  echo "scheduled-backup-contract=failed reason=$1" >&2
  exit 1
}

assert_contains() {
  file=$1
  pattern=$2
  reason=$3
  grep -Fq -- "$pattern" "$file" || fail "$reason"
}

assert_not_contains() {
  file=$1
  pattern=$2
  reason=$3
  if grep -Fq -- "$pattern" "$file"; then
    fail "$reason"
  fi
}

sh -n "$backup_script"
sh -n "$scheduled_runner"
assert_contains "$dockerfile" 'RUN apk add --no-cache "age=${AGE_PACKAGE_VERSION}"' missing-age-tool
assert_contains "$dockerfile" 'ARG AGE_PACKAGE_VERSION=' missing-age-version-pin
assert_contains "$dockerfile" 'COPY scripts/docker/scheduled-backup.sh' missing-scheduled-script
assert_contains "$compose_file" 'scheduled-backup:' missing-service
assert_contains "$compose_file" 'image: ${ATHENA_BACKUP_IMAGE:?' missing-required-backup-image
assert_contains "$compose_file" 'db-tools:' missing-production-db-tools-service
assert_contains "$compose_file" 'image: ${ATHENA_DB_TOOLS_IMAGE:?' missing-required-db-tools-image
assert_contains "$compose_preflight" 'local_image_id_re' missing-immutable-local-image-validation
assert_not_contains "$compose_file" 'athena-vault-backup:local' mutable-backup-image-tag
assert_not_contains "$compose_file" 'athena-vault-db-tools:local' mutable-db-tools-image-tag
assert_contains "$compose_file" 'POSTGRES_IMAGE: ${ATHENA_POSTGRES_IMAGE:?' missing-required-postgres-image
assert_contains "$compose_file" 'profiles: ["scheduled-backup"]' missing-opt-in-profile
assert_contains "$compose_file" 'restart: "no"' missing-one-shot-restart-policy
assert_contains "$compose_file" 'command: ["/usr/local/bin/scheduled-backup.sh"]' missing-one-shot-command
assert_contains "$compose_file" 'ATHENA_BACKUP_CONTAINER_UID:?ATHENA_BACKUP_CONTAINER_UID must be set' missing-required-backup-uid
assert_contains "$compose_file" 'ATHENA_BACKUP_CONTAINER_GID:?ATHENA_BACKUP_CONTAINER_GID must be set' missing-required-backup-gid
assert_not_contains "$compose_file" 'ATHENA_BACKUP_CONTAINER_UID:-0' root-default-backup-uid
assert_not_contains "$compose_file" 'ATHENA_BACKUP_CONTAINER_GID:-0' root-default-backup-gid
assert_contains "$compose_file" 'ATHENA_BACKUP_ENCRYPTION_RECIPIENT' missing-recipient
assert_contains "$compose_file" 'ATHENA_BACKUP_RETENTION_DAYS' missing-retention-days
assert_contains "$compose_file" 'ATHENA_BACKUP_RETENTION_COUNT' missing-retention-count
assert_contains "$backup_script" 'SCHEDULED_BACKUP_BACKUP_ROLE_NOT_RLS_CAPABLE' missing-rls-safety-check
assert_contains "$backup_script" 'rolbypassrls' missing-rls-capability-query
assert_contains "$backup_script" 'athena-vault-scheduled-*.dump.age' missing-encrypted-artifact-boundary
assert_contains "$backup_script" 'find "$backup_directory"' missing-pruning
assert_not_contains "$backup_script" 'ATHENA_BACKUP_SCHEDULE_INTERVAL_SECONDS' interval-design-remains
assert_not_contains "$backup_script" 'while :' interval-loop-remains
assert_not_contains "$backup_script" 'restore-database.sh' automatic-restore
assert_not_contains "$backup_script" 'docker compose' nested-compose-control
assert_contains "$scheduled_runner" 'ATHENA_BACKUP_HOST_PATH' missing-host-path-validation
assert_contains "$scheduled_runner" 'ATHENA_BACKUP_ENCRYPTION_RECIPIENT' missing-recipient-validation
assert_contains "$scheduled_runner" 'env -i \' missing-clean-compose-environment
assert_contains "$scheduled_runner" 'run --rm --no-deps scheduled-backup' missing-one-shot-compose-run
assert_not_contains "$scheduled_runner" 'up --detach' stack-restart
assert_contains "$systemd_service" 'Type=oneshot' missing-oneshot-service
assert_contains "$systemd_service" 'ExecStart=/bin/sh /REPLACE_ME/athena-vault/scripts/docker/run-scheduled-backup.sh /REPLACE_ME/athena-vault/.env.docker.prod' missing-service-command
assert_contains "$systemd_service" 'User=REPLACE_ME' missing-service-user
assert_contains "$systemd_timer" 'OnCalendar=*-*-* 04:00:00' missing-fixed-time
assert_contains "$systemd_timer" 'Persistent=true' missing-missed-run-policy
assert_contains "$systemd_timer" 'RandomizedDelaySec=0' unexpected-random-delay

echo 'scheduled-backup-contract=status=passed'
