# Athena Vault project map

Read [AGENTS.md](AGENTS.md) before making changes. It defines authorization, data-integrity, migration, and secret-handling rules. This page routes contributors to the code and canonical documentation; it is not an operator runbook.

| Area | Entry point |
| --- | --- |
| Next.js application | `apps/web/app` |
| Shared UI | `packages/ui` |
| Financial calculations | `packages/finance-engine` |
| Validation schemas | `packages/validation` |
| Database schema and repositories | `packages/database/src` |
| Active migrations and catalog | `packages/database/drizzle`, `packages/database/src/migrations/catalog.ts` |
| Supported Docker definitions | `docker-compose.yml` with the reviewed environment override |

Start with the [documentation index](docs/README.md). Key references: [Architecture](docs/architecture.md), [Data model](docs/data-model.md), [Security](docs/security.md), [Deployment](docs/deployment.md), [Backup and restore](docs/backup-and-restore.md), and [Historical workbook boundary](docs/excel-migration.md). Use [Contributing](CONTRIBUTING.md) for workflow and checks.

Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, and an isolated `pnpm build` as appropriate. Database integration tests require a disposable local database; never point them at production or a restored private copy. Migration application, backup restore, deployment, commit, and push require separate authorization. Public database verification needs generic checks for fresh installations; the private historical import verifier is excluded from this candidate. Report skipped checks accurately.

For schema work, inspect the active migration catalog before editing. The public one-file `0000` baseline is for fresh empty databases only; never point it at an existing private installation, which retains its separate migration chain. Do not import old workbook material or publish personal source labels, counts, fingerprints, endpoints, or operational history.
