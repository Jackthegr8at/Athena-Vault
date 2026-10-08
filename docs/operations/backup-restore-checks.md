# Backup and restore checks

The local freshness check is synthetic and cannot prove that a production backup is recoverable. Run `scripts/docker/backup-freshness-check.ts` only in its temporary test root. It checks the scheduled artifact naming contract, sidecar metadata, size/checksum, age, and refusal of symlinks or malformed entries. It must not inspect or mutate the real backup directory.

For an operator rehearsal, use a protected copy of one encrypted artifact, not the only retained copy. Verify its checksum, decrypt with the identity held outside the application host, restore into a new disposable database, and validate schema, permissions, row-level security, authentication, and expected application invariants. Record the check date, code revision, artifact identifier privately, target name, and result without logging credentials or financial rows. Investigate any failed condition before pruning or rotating backups.

Never use a live database, production named volume, or private workbook import as a test target. Never remove a failed disposable target or plaintext staging file with a broad wildcard; first verify the exact absolute path and retention need. See [Backup and restore](../backup-and-restore.md) for encryption, retention, and restore boundaries.
