# Repository agent guardrails

These rules apply to every change in this repository. Use [AGENT.md](AGENT.md) for the project map, commands, and documentation routes.

## Worktree and authorization

- Inspect `git status` before editing and preserve unrelated changes.
- Keep changes narrow, traceable, and easy to review. Prefer correctness over cleverness.
- Do not commit, push, deploy, apply migrations, change host or network configuration, mutate live financial data, restore backups, or delete data or named volumes unless the user explicitly authorizes that action.
- Treat operational and database investigation as read-only by default. Report skipped checks and blockers precisely.

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
