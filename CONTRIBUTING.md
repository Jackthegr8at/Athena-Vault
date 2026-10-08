# Contributing to Athena Vault

Thank you for helping improve Athena Vault. Contributions should keep financial behavior explicit, preserve data boundaries, and remain easy to review.

## Before you start

Read the documentation relevant to your change:

- [README.md](README.md) for the product overview and local setup
- [Documentation index](docs/README.md) for the canonical document by audience and subject
- [Architecture](docs/architecture.md) for package and domain boundaries
- [Data model](docs/data-model.md) for persistence and ownership rules
- [Security](docs/security.md) for authentication, secret handling, and data isolation

Keep the change narrowly scoped. Preserve unrelated work in the checkout, and do not commit generated files, secrets, database dumps, backups, or real financial data.

## Contributor workflow

1. Install dependencies with the pnpm version declared in `package.json`.
2. Copy `.env.example` to the ignored `.env.local` and replace every placeholder with local-only values.
3. Use a fresh or disposable local PostgreSQL database. Never run migrations, tests, seeders, or verification tools against production data.
4. Make the smallest coherent change and add focused tests for changed behavior.
5. Run the relevant local checks and inspect the final diff before submitting it.
6. Document user-visible financial-rule or architectural changes in the same contribution.

Do not add a dependency unless the existing stack cannot reasonably solve the problem. Explain any new dependency and its maintenance or security impact in the change description.

## Local checks

Run the checks that cover the changed packages:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Database changes also require the applicable PostgreSQL-backed checks against an approved disposable local database:

```powershell
pnpm db:migrate
pnpm db:verify
pnpm db:integration
```

`pnpm db:verify` inspects the final public baseline, owner-row isolation with an empty owner context, and the dedicated authentication role. It is read-only. Existing private deployments must remain on their private migration chain; the public single-baseline verifier is not an upgrade path. If a check cannot run locally, state exactly which check was skipped and why. A missing database, fixture, or runtime is a limitation, not a passing result.

## Coding and data-safety principles

- Store and calculate money as integer minor units. Never use floating point for financial values.
- Add tests for every new or changed financial calculation, including rounding and boundary cases.
- Scope every user-owned read and write by owner, including work performed inside transactions.
- Keep projections deterministic and preserve protected historical, Actual, and manually entered values.
- Do not silently change a financial rule. Make the rule visible in code, tests, and documentation.
- Validate inputs at system boundaries and keep credentials, tokens, connection strings, and financial details out of logs and fixtures.
- Prefer accessible native controls, keyboard support, clear focus states, and responsive layouts without horizontal scrolling.

## Database migrations

- Add a new migration; do not rewrite migration history that may already have been applied.
- Keep migrations guarded, idempotent where practical, and owner-safe.
- Generate and review the SQL before applying it.
- Test both a fresh schema and an already-migrated schema when the change can affect either path.
- Never use a migration to rewrite protected financial history, provenance, or user-entered data unless that transformation is the explicitly reviewed purpose of the change.

## Documentation privacy

Public-facing documentation must use generic examples and placeholders. Do not publish migration ledger identifiers, source fingerprints, internal reconciliation baselines, private hostnames or IP addresses, developer-specific paths, production volume names, backup locations, credentials, or environment-specific firewall and recovery commands.

Keep operator-specific procedures separate from the public overview. When architecture, data ownership, financial rules, or security boundaries change, update the corresponding canonical document without copying private deployment state into public-facing files.

## Change description

Include:

- the problem and the chosen behavior
- affected packages or domains
- financial or data-migration implications
- tests and checks run locally
- known limitations or checks that were not run

Do not include secrets, private financial values, or production identifiers in issues, screenshots, logs, or review notes.

## Contribution licenses and DCO sign-off

Athena Vault uses the [Developer Certificate of Origin 1.1](DCO), reproduced unmodified from [the official DCO](https://developercertificate.org/). Read it before contributing. Every contribution commit, including documentation and small fixes, must contain your `Signed-off-by` trailer certifying the DCO.

Original contributions to the project's software and documentation are submitted under [AGPL-3.0-only](LICENSE), unless the affected file explicitly carries a different license. Artwork, fonts, and third-party code retain their applicable [asset licenses](ASSET_LICENSE.md) and [third-party notices](THIRD_PARTY_NOTICES.md); preserve their notices and only submit changes you are entitled to license under the applicable terms. Identify any third-party material and its source/license in the change description.

Contributors retain ownership of their contributions. No copyright assignment or separate contributor license agreement (CLA) is required. The DCO certifies your right to submit the work; it does not grant the maintainer additional rights to relicense your contribution under proprietary or other terms. Any later relicensing must respect the rights and licenses of all included work.

### Signing off a commit

Use Git's lowercase `-s` / `--signoff` option when creating each contribution commit:

```sh
git commit --signoff
```

Git adds a trailer using your configured Git name and email:

```text
Signed-off-by: Your Name <your-public-commit-email>
```

Use your own identity and an email that identifies you in the commit metadata; do not sign off for another person. Commit metadata and sign-offs become public and may be retained indefinitely. To keep your personal email private, configure your GitHub-provided noreply address before creating commits; see [GitHub's commit-email privacy guidance](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).

Sign-off is a DCO certification, not a cryptographic signature (`git commit -S`). Do not add a sign-off until you can truthfully make the certification. AI-assisted contributions are subject to the same responsibility: review the result, establish your right to submit it, and disclose any known third-party license restrictions.

### Maintainer acceptance

Before merging, review the sign-off on every proposed contribution commit and its corresponding author. Ask contributors to correct missing or mismatched sign-offs on their own contribution branch; never add another person's certification on their behalf. Retain existing author attribution and sign-offs when integrating or squashing contributions.

This is the documented merge policy, not an automatically enforced repository check. No external DCO app or CI workflow is configured. GitHub's optional web-commit sign-off setting covers only commits created through its web interface, not CLI pushes; maintainer review is still required. See [GitHub's sign-off policy documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-commit-signoff-policy-for-your-repository).

These terms apply to new contributions submitted for acceptance under this policy; they do not retrospectively certify historical private commits or transfer rights to previously submitted work.

## Security reports

Follow [SECURITY.md](SECURITY.md) for private vulnerability reports; the GitHub reporting feature must be activated on the future public repository before release. Do not post exploit details or real records in a public issue.
