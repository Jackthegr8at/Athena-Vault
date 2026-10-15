# Repository agent guardrails

These rules apply to every change in this repository. Use [AGENT.md](AGENT.md) for the project map, commands, and documentation routes.

## Worktree and authorization

- Inspect `git status` before editing and preserve unrelated changes.
- Keep changes narrow, traceable, and easy to review. Prefer correctness over cleverness.
- Do not commit, push, deploy, apply migrations, change host or network configuration, mutate live financial data, restore backups, or delete data or named volumes unless the user explicitly authorizes that action.
- Treat operational and database investigation as read-only by default. Report skipped checks and blockers precisely.

## Private/public publication boundary

- This checkout is public. Keep its push remotes restricted to the intended public repository; never add or fetch private repository remotes here.
- Accept shared changes only as explicitly reviewed public-safe files or patches. Never merge private branches, copy private Git metadata, or import private history.
- Never publish private-only features, personal financial records, real-data fixtures, environment files, credentials, database exports, backups, operator-specific configuration, internal plans, or mockup assets. Only sanitized example environments and approved application assets may be published.
- Preserve the public fresh-install baseline and generic verifier. Never copy the private migration chain or historical data assertions into this checkout.
- Before each public push, inspect Git status, review the complete staged diff and outgoing history, run publication path/content guards and a redacted secret scan, and obtain explicit public commit/push authorization. Private-repository approval does not authorize publication.
- Never disable or bypass publication hooks, secret scanning, or push protection to make a push succeed. Missing tools or failed checks require resolution before pushing.
- Install and maintain the public-only pre-push guard using [publication safety](docs/publication-safety.md); never install it in the private checkout.
- Agent instructions and automated scans cannot detect every sensitive record or private-only feature. Human review remains necessary; do not treat a clean scan as a guarantee.

## Financial and data integrity

- Store and calculate money in integer minor units; never use floating point for money.
- Add focused tests for every financial calculation and make rule changes explicit in code, tests, and documentation.
- Scope reads and writes by owner. Keep multi-row financial writes transactional and reject unexpected row counts.
- Preserve Actual rows, manual projection anchors, accepted import identity, source provenance, backups, and existing user data unless a narrowly approved task says otherwise. Never rerun workbook acceptance to repair current data.
  - The retired private workbook is historical provenance only; it is not a current input for new work and must not be treated as source data.
- Cash Flow account visibility is a persistent display-only preference: hidden accounts remain in projections and can be restored with **Show all accounts**.

## Schema, security, and dependencies

- Inspect the migration catalog and migration directory before schema work. Never rewrite an applied migration; add the next guarded, idempotent migration and review it before any application.
- Never request, print, log, commit, or place in fixtures any password, passphrase, token, private key, connection string, or sensitive financial record.
- Avoid new dependencies unless the change clearly justifies them.

## Verification and documentation

- Run the smallest relevant local checks, then broader checks in proportion to risk. Do not claim database or runtime validation that did not execute.
- Update canonical documentation when architecture, financial rules, data boundaries, or operator procedures change; avoid copying runbooks into agent files or the root README.
