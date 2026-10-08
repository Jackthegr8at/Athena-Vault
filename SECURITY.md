# Security policy

## Reporting a vulnerability privately

For the public GitHub repository, use **Security → Advisories → Report a vulnerability**. This opens GitHub's private vulnerability-reporting form; do not open a public issue with exploit details.

Describe the affected version or commit, impact, reproduction steps, and a minimal synthetic example. Do not submit passwords, tokens, database dumps, account balances, personal records, or copies of a real financial database.

Reports are reviewed and discussed in the private GitHub advisory. Coordinate disclosure with the maintainer before making exploit details public.

This repository is currently being prepared for publication. The channel is selected, but the future public repository must have private vulnerability reporting enabled before release. If the reporting button is unavailable, do not post details publicly; the maintainer must activate the channel first. A GitHub `users.noreply.github.com` address is for commit privacy, not the project's reporting contact.

## Maintainer setup before publication

1. On the public GitHub repository, enable **Settings → Advanced Security → Private vulnerability reporting**.
2. Under **Watch**, select **Custom → Security alerts** (or **All Activity**).
3. In your GitHub notification settings, enable **Email** for watched repositories. Reports then generate notifications to your configured private account email without publishing that email in this policy.
4. Confirm that the reporting button and notification preferences are configured before recording the channel as operational.

See [GitHub's reporting and notification instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository). No public email address or separate forwarding mailbox is required for this channel.

## Supported versions

No public release exists yet, so there is no released-version support promise. Before the first release, findings should identify the candidate commit. Version support and response targets will be published when releases begin; this policy does not promise a response deadline or a bounty.

## Scope

Relevant findings include authentication, authorization, owner isolation, financial-data exposure, and unsafe deployment or backup/restore behavior. Use ordinary issues for non-sensitive feature requests and defects after the public repository opens.

Test only installations you own or are authorized to assess, using synthetic data. Never test against another person's financial records.

See [operational security guidance](docs/security.md) for the self-hosting boundary.
