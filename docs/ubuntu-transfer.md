# Transfer Athena Vault to Ubuntu

This guide stages a reviewed application release on a prepared Ubuntu host. It does not authorize transferring an existing private production database, opening network access, or restoring into a live volume. Start with [Ubuntu host preparation](ubuntu-host-preparation.md).

1. Record the reviewed source commit and confirm the worktree is clean. Package only approved release files from that commit; do not bundle `.git`, ignored environment files, credentials, private keys, workbook data, backups, generated Caddy state, or operator-specific plans.
2. Generate and verify a cryptographic checksum for the archive. Transfer the archive and checksum through an approved administration channel, then verify the checksum on the host before unpacking into the operator-owned application directory. A checksum detects transfer corruption; authenticate the source separately.
3. Create the ignored production environment file on the host from `.env.docker.example`, using unique secrets and the operator's own hostname/network settings. Keep it mode `0600`. Render both Compose files together with `docker compose config` and inspect the host ports, volumes, image references, and secret placeholders before starting services.
4. For a **fresh public installation**, start with an empty application database and follow [Deployment](deployment.md). The public one-baseline migration path planned for this repository is not an upgrade path for an existing private database.
5. If a separately approved recovery requires a backup, keep the artifact encrypted during transfer, verify its checksum, and decrypt it only into a protected temporary location. Rehearse a restore into a disposable database first and verify schema, ownership, grants, authentication, and expected data invariants. Follow [Backup and restore](backup-and-restore.md); never point a restore command at a live or named production volume by default.
6. Keep the service loopback-bound until setup, health, authentication, backup, and network checks pass. Only then apply the operator's reviewed firewall/TLS exposure plan. Preserve the prior release and a tested recovery route; an application rollback does not reverse database migrations.

Do not run the retired workbook importer to reconstruct or repair current data. Do not include real financial records in test fixtures or issue reports.
