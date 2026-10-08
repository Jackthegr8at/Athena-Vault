# Backup and restore

PostgreSQL backups contain sensitive financial and authentication data. Keep backup artifacts outside the repository and Docker images, encrypt before retention or transfer, restrict access, and keep the private decryption identity off the application host. A successful backup command is not proof of recoverability: rehearse a restore into an isolated disposable target.

## Manual backup

Run `scripts/docker/backup.sh` only against the intended, healthy stack with its protected ignored environment file. The helper writes a PostgreSQL custom-format dump to the configured protected host backup directory, refuses to overwrite an existing file, and reports only path/size/checksum metadata. Review its selected Compose project, database volume, and destination before invoking it. Do not paste the resulting filename or checksum into public documentation or issues if it identifies a private installation.

Use `scripts/docker/verify-restore.sh` against a new, unique disposable verification target. It refuses an existing target, restores the selected dump, and runs the same final-schema and role-isolation checks used by recovery. A failed disposable target is retained for diagnosis, so remove it only after checking its exact name and contents. Never run a restore against the production database by default. The rehearsal does not establish business-data completeness or replace application/browser checks.

## Encryption and retention

Encrypt each backup with an operator-owned public age recipient before transfer or long-term retention. Verify the encrypted file and checksum before removing any plaintext staging copy. Store the private age identity on a separate protected recovery device. Define a retention policy appropriate to your requirements; scheduled retention applies only to its own encrypted artifact family, not manual backups, named volumes, or unrelated files.

Scheduled backups are opt-in. Configure `ATHENA_BACKUP_HOST_PATH`, `ATHENA_BACKUP_ENCRYPTION_RECIPIENT`, `ATHENA_BACKUP_CONTAINER_UID`, `ATHENA_BACKUP_CONTAINER_GID`, retention inputs, and any database-role inputs according to `.env.docker.example`, using the host operator's actual numeric UID/GID. Confirm directory ownership and mode, then run one manual encrypted scheduled-backup invocation and a disposable restore before enabling a timer. Normal Compose startup never starts the scheduled profile. The one-shot worker must fail if PostgreSQL is unhealthy or recipient/path configuration is absent; it must not start a new database or delete a volume.

## Restore procedure

1. Identify an exact encrypted artifact and compare its size/checksum with independently recorded metadata. Confirm that the target is disposable or is a separately approved recovery database; capture the target name and volume before any command runs.
2. Decrypt on a controlled recovery machine into a protected temporary directory. Do not copy the private identity into Compose, the repository, or the application host. Transfer plaintext only through an approved protected channel if the restore helper requires it.
3. Rehearse the supplied restore flow into the disposable target. It resets the `athena_app` and `athena_auth` login credentials from the protected Docker environment, restores with `--no-owner` while preserving dump ACLs, then verifies the final schema baseline, owner-row isolation, and authentication-role access without printing private rows. Do not add `--no-privileges`: it strips grants required by the application.
4. Preserve the source artifact and failure evidence until diagnosis is complete. Remove only the exact plaintext temporary copy and disposable target after explicit verification. Do not delete named production volumes, reset migrations, or rerun a retired workbook importer.

Restoring an existing private deployment into a future fresh-install public schema is unsupported; retain the private migration chain and recovery runbook for that installation. See [Backup and restore checks](operations/backup-restore-checks.md) for the synthetic local check and operator rehearsal boundary.
