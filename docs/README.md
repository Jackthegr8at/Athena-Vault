# Athena Vault documentation

The root [README](../README.md) is the project overview and local-development starting point. This index routes readers to the canonical document for each subject; some documents appear in more than one audience because product rules and implementation constraints overlap.

## User and product

- [Project overview](../README.md) — capabilities, local entry points, and links into the documentation set.
- [Data model](data-model.md) — financial-domain behavior, ownership boundaries, calculation rules, and the operational meaning of persisted data.
- [Cash Flow recurring series](architecture.md#cash-flow-recurring-series) — version history, protected-occurrence handling, and transactional history-version deletion.
- [Investment planning](investment-planning.md) — REEI/RDSP holdings, symbol search and read-only instrument verification, calculator and portfolio projection modes, read-only Cash Flow contribution sources, and current validation boundaries.
- [In-app page guides](ui-guides.md) — contextual help coverage, first-use guidance, and route conventions.
- [Calculation workbench](architecture.md#private-calculation-workbench) — the private owner-scoped `/workbooks` scratch area; see Architecture for its technical boundary until a dedicated product guide exists.

## Engineering

- [Architecture](architecture.md) — monorepo responsibilities, service boundaries, persistence access, and derived read models.
- [Data model](data-model.md) — schema-backed domain rules that code and tests must preserve.
- [Contributing](../CONTRIBUTING.md) — contributor workflow, local checks, migration discipline, and documentation-privacy rules.
- [Migration catalog](../packages/database/src/migrations/catalog.ts) — executable migration order, schema-state inspection, and post-application verification.
- [Agent handoff](../AGENT.md) — repository entry points, common local commands, and routing to canonical documentation.

## Operations

Read the applicable runbook immediately before performing operational work; do not rely on copied commands or remembered environment values.

- [Security](security.md) — authentication, ownership, network, secret, backup, and verification boundaries.
- [Public-edge TLS](public-edge-tls.md) — general guidance for a separately operated HTTPS edge and authenticated inner TLS.
- [Deployment](deployment.md) — supported Compose topology, operator-configured HTTPS, setup, updates, and rollback boundaries.
- [Shared demo workspace](deployment.md#optional-shared-demo) — explicit synthetic fixture provisioning and read-only demo operation.
- [Backup and restore](backup-and-restore.md) — manual and scheduled backups, encryption, retention, disposable restore verification, and recovery policy.
- [Ubuntu host preparation](ubuntu-host-preparation.md) — operating-system, SSH, firewall, Docker, paths, and pre-start validation.
- [Ubuntu transfer](ubuntu-transfer.md) — reviewed release transfer, optional encrypted backup handling, and fresh-install boundaries.

## Documentation ownership

- Keep the root README high-level and free of private topology, credentials, mutable record counts, and recovery commands.
- Keep agent files concise: `AGENTS.md` owns repository guardrails, while `AGENT.md` owns handoff and navigation.
- Update the canonical engineering or operations document when its contract changes, and update this index when documents are added, renamed, or retired.
- Treat the migration catalog and checked-in SQL as the source of truth for the current migration sequence; avoid hard-coded “latest migration” claims in handoffs.

## Release and reporting

- [Local release gate and security checks](deployment.md#local-release-gate) — verification runs locally, not in a cloud CI service.
- [Container image pinning](container-base-digests.md) — review current digests and provenance before deployment.
- [Backup and restore checks](operations/backup-restore-checks.md) — synthetic checks and safe rehearsal boundaries.
- For a vulnerability, use private reporting through the repository host if enabled; otherwise request private maintainer contact without publishing exploit details. The publication checklist must establish a concrete private channel before release.
