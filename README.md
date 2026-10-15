# Athena Vault

Athena Vault is a self-hosted personal-finance and projection workspace. It combines day-to-day tracking with long-range planning while keeping each workspace's data owner-scoped. It is intended for operators who can secure their own database, backups, and HTTPS endpoint; it is not a managed financial service.

PostgreSQL is the authoritative operational store. Financial amounts are represented as integer minor units, and financial rules are designed to be explicit, deterministic, and covered by focused tests.

## Features

- Net-worth overview and account balance timelines
- Cash-flow periods, recurring series, transfers, payday checks, and protected version history
- Annual-expense budgets and household maintenance planning
- Home-value, mortgage-principal, salary, and retirement projections
- REEI/RDSP holdings with ledger-based valuation and read-only instrument verification
- Investment scenarios with manual or cash-flow-linked contributions
- Private spreadsheet workbench for formulas, comparisons, and what-if planning, separate from operational financial records
- Shared expense splitting and payment tracking
- Contextual page guides with workspace-aware next actions
- Server-side authentication and owner-scoped data access

## Documentation

- [Documentation index](docs/README.md) — documentation grouped by user/product, engineering, operations, and history audiences
- [Contributing](CONTRIBUTING.md) — contributor workflow, checks, and data-safety principles
- [Data model](docs/data-model.md) — product rules and domain boundaries
- [Architecture](docs/architecture.md) — packages, persistence, and read-model boundaries
- [Request-data optimizations](docs/request-data-optimization.md) — bounded reads, deferred details, synthetic evidence, and validation limits
- [Investment planning](docs/investment-planning.md) — REEI/RDSP holdings, symbol search and instrument verification, calculator/portfolio modes, Cash Flow source boundaries, and validation status
- [Security](docs/security.md) — authentication, ownership, secrets, and operational safety
- [Backup and restore](docs/backup-and-restore.md) — encrypted backups, standalone restore verification, and local runtime-permission reconciliation
- [In-app page guides](docs/ui-guides.md) — contextual help coverage and route conventions
- [Deployment](docs/deployment.md) — production configuration and first-run checks

## Local development

Prerequisites are Node.js 22, the pnpm version declared in `package.json`, and a local PostgreSQL 18 instance. From the repository root, install dependencies and create an ignored environment file:

```powershell
pnpm install
Copy-Item .env.example .env.local
```

Replace every placeholder in `.env.local` with generated, local-only values. Use a fresh development database; never point development commands at a production database or a retained financial-data backup.

Optional investment symbol autocomplete uses the server-only `ATHENA_EODHD_API_TOKEN`. For a standalone web process, put it in the ignored environment used by `apps/web` (for example `apps/web/.env`); for Docker, put it in the selected ignored Compose environment file. It is not required for manual symbol entry or the local Vanguard mutual-fund fallback, and it must never use a `NEXT_PUBLIC_` variable.

After the local database and roles are available, review the migration target, initialize a **new empty** development database, and start the app:

```powershell
pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and create the first workspace account through `/setup`.

Run the local quality checks with:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Database-backed checks are:

```powershell
pnpm db:integration
```

Run database commands only against an explicitly configured disposable local test database. A public database verification command is pending generic checks for fresh installations; the private historical import verifier is excluded from this candidate.

For an explicitly approved standalone backup test, follow the [backup and restore runbook](docs/backup-and-restore.md). Its local restore keeps the portable archive privilege-free, then reconciles the local PostgreSQL ownership and application grants before declaring the application-ready restore successful.

## Deployment

The repository includes container definitions for self-hosting. A deployment must provide its own secrets, TLS and trusted-origin configuration, database storage, backups, and network controls. Review and adapt the configuration for the target environment; do not expose the application or database using development defaults.

### Docker quickstart

For local Docker development, install Docker Desktop, copy the committed example environment file, and replace its placeholder database and authentication values with local-only values:

```powershell
Copy-Item .env.docker.example .env.docker
```

For this local development stack, set the Docker environment values to local-only values, including:

```dotenv
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
ATHENA_AUTH_COOKIE_SECURE=false
```

A genuinely empty database is detected and schema-bootstrapped without historical migration data. Also replace the database password placeholders in `DATABASE_URL`, `ATHENA_MIGRATOR_DATABASE_URL`, `ATHENA_MIGRATOR_PASSWORD`, and `ATHENA_DB_PASSWORD`. Do not reuse production credentials or commit `.env.docker`.

Start the development stack from the repository root:

```powershell
docker compose --env-file .env.docker `
  -f docker-compose.yml -f docker-compose.dev.yml up --detach --build
```

Open [http://localhost:3000](http://localhost:3000) and complete the first-run setup at `/setup`. The development override publishes only the web service on localhost; PostgreSQL remains inside the Docker network. The database and development dependencies are stored in named Docker volumes, so stopping the stack does not remove them.

View service status and logs with:

```powershell
docker compose --env-file .env.docker `
  -f docker-compose.yml -f docker-compose.dev.yml ps
docker compose --env-file .env.docker `
  -f docker-compose.yml -f docker-compose.dev.yml logs --follow web
```

Stop the stack without deleting its data:

```powershell
docker compose --env-file .env.docker `
  -f docker-compose.yml -f docker-compose.dev.yml down
```

For a production-like self-hosted deployment, use `.env.docker.prod` with the production override. It adds Caddy for HTTPS and keeps PostgreSQL and the web service private to the Docker network:

```sh
docker compose --env-file .env.docker.prod \
  -f docker-compose.yml -f docker-compose.prod.yml up --detach --build --wait
```

Before using the production override, follow the [deployment runbook](docs/deployment.md), especially its environment, TLS, trusted-origin, backup, and network-boundary requirements. Never use development secrets, expose the database directly, or add `--volumes` to ordinary stop or update commands.

The optional shared demo uses synthetic data and a separate read-only workspace. It is disabled by default, provisioned explicitly, and is not a place to import or expose real financial records; see the [demo procedure](docs/deployment.md#optional-shared-demo).

Environment-specific host preparation, firewall policy, certificate handling, backup locations, and recovery procedures are intentionally outside this overview. Operators should use the [operations documentation](docs/README.md#operations) and supply their own values.

## Data boundary

The former one-time workbook importer is retired and is not a supported setup path. A fresh install starts with an empty PostgreSQL database. Do not import somebody else's financial records or restore a private deployment backup into a public demo.

## Project status

### Installation and support boundary

- The proposed public release is for fresh installations into an empty PostgreSQL database. Its single SQL baseline is not an upgrade path for the private deployment or another populated database.
- The demo uses synthetic data for evaluation. It is not a place to import personal records and is not a production backup service.
- Self-hosters own access controls, TLS, secrets, software updates, and encrypted backups. Rehearse restoration to a separate disposable target before relying on a backup; never test a restore over live data.
- There is no public version or response-time/support guarantee yet. Future upgrade instructions must identify supported source and target versions; until then, do not treat a fresh-install baseline as an upgrade procedure.

See [deployment](docs/deployment.md), [backup and restore](docs/backup-and-restore.md), and [security reporting](SECURITY.md).

Athena Vault is under active development and has not yet been published as a public-source release. Interfaces, setup procedures, and deployment support may change. Contributions follow the [AGPL and DCO sign-off policy](CONTRIBUTING.md#contribution-licenses-and-dco-sign-off). Final release checks remain pending; GitHub private vulnerability reporting must be activated on the future public repository before publication.

## License

Athena Vault's software source code is licensed under the [GNU Affero General Public License, version 3 only](LICENSE) (`AGPL-3.0-only`). Commercial use is permitted under the license. Distribution and modified versions offered over a network must meet the applicable source-availability requirements; see the full license for the conditions.

The listed application artwork is licensed under [CC BY-SA 4.0](ASSET_LICENSE.md); third-party fonts and dependencies retain their own licenses and [notices](THIRD_PARTY_NOTICES.md). The public release includes only artwork referenced by the application; the private `mockup/` directory and its contents are excluded entirely. Trademark and endorsement rights are not granted by these copyright licenses.

For setup or feature questions, use the public repository's issue tracker after it opens, without posting credentials, balances, or personal records. Report vulnerabilities privately through GitHub's reporting form as described in [SECURITY.md](SECURITY.md); never disclose exploit details in a public issue. See [operational security guidance](docs/security.md) for self-hosting responsibilities.
