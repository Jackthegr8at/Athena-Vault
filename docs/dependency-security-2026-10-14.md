# Dependency security maintenance — 2026-10-14

Security updates target the reported dependency graph, not application data or migrations.

- Next.js and its ESLint configuration: 16.3.8.
- Nodemailer: 10.0.9 (updated again in the 2026-10-15 follow-up below).
- Sharp: 0.35.5; gRPC: 1.14.6; source-map-js: 1.2.2.
- A version-scoped override updates affected brace-expansion 4/5 releases to 5.0.12 without replacing the separate legacy 1.x API.
- All workspace Vitest versions: 4.1.11. This removes Tinypool rather than forcing its incompatible major version into Vitest 3.
- Node type definitions and the existing script database driver are explicitly declared at the root rather than relying on incidental dependency hoisting.

## Current remediation — removal of the vulnerable lint dependency

The only installed path to `braces` was `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. An override scoped to `@next/eslint-plugin-next@16.3.8` replaces that plugin's `fast-glob` edge with `tinyglobby@0.2.17`, a package/version already present in the graph. The plugin uses only `globSync(pattern, { onlyDirectories: true })`. A small version-scoped plugin patch explicitly preserves absolute-path results and disables implicit directory expansion. The project's Next/React/TypeScript lint configuration and rules remain enabled.

The new graph removes `braces`, `micromatch` and `fast-glob` rather than changing an affected version's label or suppressing an advisory. The previous `braces` patch is retired; Docker still copies the remaining plugin compatibility patch before its frozen dependency installation. Fresh registry audits in both checkouts report zero advisories. This is a point-in-time result, not a claim that GitHub has rescanned unpushed changes or that future vulnerabilities cannot exist.

Run `node --test scripts/security/dependency-patches.test.mjs scripts/security/dependency-upgrades.test.mjs`. Regression coverage verifies the installed replacement identity, absence of the vulnerable graph in the lockfile, Docker patch ordering, directory-only/default/missing/relative/absolute roots, arrays, brace patterns, spaces, Windows separators, and a real Next internal-navigation rule violation. The other dependency tests retain legacy brace-expansion and offline mail coverage. Reevaluate the scoped override and patch whenever the Next ESLint plugin version changes; do not assume compatibility with arbitrary plugin APIs.

## Historical braces mitigation (retired)

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) had no upstream patched version when reviewed. The earlier pnpm patch for braces 3.0.3 guarded parser depth and caller-supplied AST depth/cycles. It was a local mitigation, not an upstream release, and version-only scanners continued to report it. The dependency-removal remediation above supersedes that patch; no alert was manually dismissed.

Run the installed-patch regressions with:

```sh
node --test scripts/security/dependency-patches.test.mjs
```

The earlier patch is recoverable from Git history but is no longer an installation input. Keep the current lint compatibility patch and its lockfile hash in fresh installations and Docker builds. Dependency notices must be regenerated for the installed graph. Missing upstream notices are not silently cleared by these security changes.

These source changes do not update a running deployment. Deployments require separately authorized rebuild/update and runtime verification. No live financial database or backup is required for unit tests.

## Remaining-alert follow-up — 2026-10-15

Nodemailer is pinned to 10.0.9. A separate version-scoped override updates legacy `brace-expansion` 1.x to 1.1.21 without replacing its API with 5.x; the existing 5.0.12 override remains unchanged. Both checkouts retain the pinned `braces` depth/cycle mitigation and regenerate notices for the installed dependency graph.

At that intermediate checkpoint, the lockfile audit reported one high advisory (`braces`) and zero critical, moderate or low advisories, down from seven unique advisories. The dependency-removal remediation above supersedes this count. No GitHub alert was dismissed on the basis of the local patch.

Run `node --test scripts/security/dependency-upgrades.test.mjs scripts/security/dependency-patches.test.mjs` for installed dependency checks: ordinary legacy expansion, bounded hostile patterns, malformed quoted-local-part parsing, offline notification generation, and the existing deep/cyclic AST protections. The tests use synthetic values and do not contact SMTP or a financial database.

## Earlier publication recheck — 2026-10-15 (superseded)

The exact updated lockfile passes a frozen installation. Patch regressions cover ordinary patterns, excessive parser nesting, caller-supplied deep/cyclic ASTs, and copying the patch into the Docker dependency layer before installation.

A fresh registry audit at that earlier checkpoint reported 5 high and 2 moderate advisories, with zero critical or low advisories. The reported packages were `brace-expansion`, `nodemailer` and `braces`. The remaining-alert follow-up above supersedes that count; the `braces` guard remains a local mitigation. Registry advisory results can change; rerun the audit for any release decision. This record does not waive source-notice or future binary-redistribution obligations.
