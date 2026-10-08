# Security

Athena Vault is a self-hosted financial application. The operator is responsible for host security, network access, TLS, secrets, backups, monitoring, and timely updates. Do not put real financial records, credentials, private keys, or database dumps in the repository, issues, logs, or demo fixtures.

## Application and network boundary

Better Auth provides server-side sessions. Production uses secure, HTTP-only cookies and an exact HTTPS `BETTER_AUTH_URL`. Keep `ATHENA_AUTH_COOKIE_SECURE=true`; configure trusted origins and browser-visible port to match the actual edge. State-changing requests require valid same-origin signals. If using a reverse proxy, trust forwarded client identity only from the exact proxy source and never publish `web` directly. A proxy marker alone does not protect against a compromised container on the same Docker network.

The root production Compose stack publishes only Caddy; PostgreSQL, migrations, and `web` stay internal. Review the rendered Compose ports and volumes. Restrict Docker-published ports with both host and Docker-forwarding firewall policy. Do not expose the Docker socket/API. A private DNS name or VPN membership is not an authentication substitute. If an external edge proxy is used, verify its inner TLS hop as described in [Public-edge TLS](public-edge-tls.md).

## First-run setup and secrets

Production requires a nonempty `ATHENA_AUTH_SETUP_TOKEN` for `/setup`; a missing token fails closed. Complete setup from a trusted client, then confirm it closes after the first account exists. Store the token, database credentials, `BETTER_AUTH_SECRET`, and optional provider credentials only in protected ignored server-side configuration. Rotate secrets with an operator-reviewed session and recovery plan; rotating the auth secret invalidates sessions. Never use `NEXT_PUBLIC_` for server credentials.

Manual user bootstrap/recovery scripts are separate operator workflows, not automatic startup steps. Do not put passwords or tokens on a command line, in Git, or in support output. Enable multifactor authentication where available and retain recovery material in a separate protected location.

## Data integrity and demo

All financial reads and writes must be owner-scoped. Money is represented in integer minor units. Multi-row mutations must be transactional and reject unexpected row counts. Row-level security and owner context are defense in depth; tests must confirm fail-closed behavior for missing or invalid owner context. Do not rerun a retired workbook import to repair current data or use an existing private database with a fresh-install migration runner.

The optional demo is synthetic and read-only. It must be provisioned explicitly for the selected stack, never on routine startup. The provisioner refuses unexpected fixture drift rather than overwriting user data. Authentication and account mutation endpoints must reject the demo owner; sign-out remains available.

## Backup and recovery

Custom-format PostgreSQL backups contain sensitive financial data. Encrypt them before retention or transfer, restrict access, and keep the decryption identity off the application host. Run a disposable restore rehearsal before relying on a backup. Normal Compose startup never restores data. Preserve Actual rows, provenance, migration history, and named volumes unless a separately approved recovery procedure says otherwise. See [Backup and restore](backup-and-restore.md).

## Verification and reporting

Run the local release gate, focused financial/security tests, a content/secret scan, and an isolated browser check before a public release. A passing unit suite is not evidence that database, browser, or production-edge checks ran. Review image digests and provenance separately. Report vulnerabilities through GitHub private vulnerability reporting as documented in [SECURITY.md](../SECURITY.md); the feature must be activated on the future public repository before publication. Do not publish exploit details or real records in an issue.
