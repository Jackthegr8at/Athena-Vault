# Deployment

This guide is for a new, empty self-hosted installation. It does not migrate an existing private Athena Vault database. Use the root `docker-compose.yml` and `docker-compose.prod.yml` together; do not run the legacy Compose file under `infrastructure/docker/`. PostgreSQL, migrations, and `web` stay on the internal Docker network. Caddy is the only published service.

Prepare the host with [Ubuntu host preparation](ubuntu-host-preparation.md), then stage the release as described in [Ubuntu transfer](ubuntu-transfer.md). Keep all environment files ignored and mode `0600`; never put credentials, database dumps, or Caddy private keys in the checkout or image. Review the rendered Compose configuration before starting anything:

```sh
docker compose --env-file .env.docker.prod \
  -f docker-compose.yml -f docker-compose.prod.yml config
```

## HTTPS and network boundary

The example uses loopback binding for local staging. Before making the service reachable, choose an operator-owned hostname, HTTPS port, trusted client networks, and host firewall rules. Set `ATHENA_PROD_BIND_HOST`, `ATHENA_PROD_HTTP_PORT`, `ATHENA_PROD_HTTPS_PORT`, `ATHENA_PRIVATE_HOSTNAME`, `BETTER_AUTH_URL`, `ATHENA_AUTH_PUBLIC_HTTPS_PORT`, and `ATHENA_AUTH_COOKIE_SECURE=true` in the ignored environment file. `BETTER_AUTH_URL` must be the exact browser-visible HTTPS origin. If a separate proxy terminates public TLS, follow [Public-edge TLS](public-edge-tls.md). Do not expose PostgreSQL, `web`, or the Docker API. Keep `/setup` inside a trusted administration boundary.

The firewall must cover Docker-published ports as well as the host input chain. Confirm the actual bind address, allowed sources, and redirect behavior before opening external access; this repository cannot determine a safe CIDR for your network. If running two stacks on one host, assign separate Docker subnets, Caddy addresses, volumes, environment files, and `ATHENA_AUTH_TRUSTED_PROXY_IPS` values. Do not reuse a certificate authority or proxy trust setting across stacks without verifying the intended boundary.

Caddy uses an internal certificate authority for private origins. Export only its public root certificate, verify its fingerprint out of band, and trust it only on approved clients. Never export or distribute its private root key. Configure the browser-visible HTTPS port even when a reverse proxy uses a different inner port. A trusted proxy may forward client identity only when the application is not directly reachable; see [Security](security.md).

## First startup and `/setup`

Copy `.env.docker.example` to an ignored environment file and replace all placeholders with unique values. Set strong database and Better Auth secrets, an exact HTTPS origin, a nonempty `ATHENA_AUTH_SETUP_TOKEN`, and reviewed immutable image IDs for `ATHENA_BACKUP_IMAGE` and `ATHENA_DB_TOOLS_IMAGE`. Production setup fails closed without the token. Do not print or store token values in shell history or logs.

```sh
sh scripts/docker/prod-up.sh .env.docker.prod
```

Complete `/setup` only from the trusted origin, then verify login, `/api/health`, and that the setup page is closed after the first account exists. The read-only `scripts/docker/smoke-pages.ps1` helper can check the configured local Docker routes after startup. The normal startup does not restore a backup or seed a demo. The public migration catalog contains only `0000_current_schema_baseline.sql` and is intended for a fresh empty database. On a disposable empty development database only, `ATHENA_DOCKER_EMPTY_DATABASE=true` can be used when the migration path requires it; never set it on copied or production data. Never point the one-baseline public runner at an existing private database.

The optional `ATHENA_EODHD_API_TOKEN` remains server-only; leaving it empty disables external symbol suggestions but preserves manual entry. Never use a `NEXT_PUBLIC_` variable for it.

## Optional shared demo

The demo is synthetic, read-only, disabled by default, and not started by regular Compose startup. Provisioning is available only through the explicit `demo-provision` Compose profile. For that one-off run, set `ATHENA_DEMO_ENABLED=true` and `ATHENA_DEMO_TARGET_CONFIRM` to the exact `ATHENA_DB_NAME` in the same environment file; the provisioner also checks that the connected database has that name. Use only synthetic credentials and verify that edits and account/security mutations are rejected for the demo owner. Do not treat reprovisioning as a reset or use real financial data as a fixture.

## Updates, backups, and rollback

For a single stack, use `scripts/docker/status.sh`, `logs.sh`, `prod-up.sh`, and `prod-down.sh` with the same ignored environment file. The explicit `scripts/docker/enable-private-https.sh` helper can switch the production example to internal HTTPS; it requires `ATHENA_ROTATE_AUTH_SECRET=true`, saves a restrictive pre-change copy, and rotates the auth secret, so review its target and retain the recovery copy. Inspect the target volume and rendered Compose config before updates. A successful application update is not a database rollback. Never add `--volumes` to an ordinary stop or update.

Encrypted backups and disposable restore rehearsals are described in [Backup and restore](backup-and-restore.md). Scheduled backup is opt-in only after a manual backup and isolated restore succeed. Keep the private decryption identity outside the application host; do not assume a backup exists because a timer is installed. Restores must target an explicitly approved disposable or recovery database, never the current live database by default.

## Local release gate

Run `./scripts/release-gate.sh` from the repository root. The local gate covers typechecks, lint, tests, deployment-script contracts, migration catalog, an isolated production build, and a dependency audit; it does not deploy or apply migrations. Database integration and browser tests require separate disposable inputs and must be reported as unrun when unavailable. The optional security suite needs its documented local tools and an immutable image reference where applicable. Validate the merged production Compose configuration with the base and override files before release. Do not use a real production environment file as a test fixture.

The release gate is not a substitute for image provenance review, secret scanning, browser coverage, or a guarded backup/restore rehearsal. See [Security](security.md) and [backup/restore checks](operations/backup-restore-checks.md) for those boundaries.
