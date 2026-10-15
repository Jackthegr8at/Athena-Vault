# Dependency security maintenance — 2026-10-14

Security updates target the reported dependency graph, not application data or migrations.

- Next.js and its ESLint configuration: 16.3.8.
- Nodemailer: 10.0.9 (updated again in the 2026-10-15 follow-up below).
- Sharp: 0.35.5; gRPC: 1.14.6; source-map-js: 1.2.2.
- A version-scoped override updates affected brace-expansion 4/5 releases to 5.0.12 without replacing the separate legacy 1.x API.
- All workspace Vitest versions: 4.1.11. This removes Tinypool rather than forcing its incompatible major version into Vitest 3.
- Node type definitions and the existing script database driver are explicitly declared at the root rather than relying on incidental dependency hoisting.

## Unpatched upstream braces

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no upstream patched version. The pinned pnpm patch for braces 3.0.3 rejects parser nesting at 128 levels and validates caller-supplied ASTs iteratively before recursive compilation, expansion or stringification. Cyclic ASTs are rejected. Ordinary patterns retain their behavior. This is a local mitigation, not an upstream fixed release; version-only scanners may continue to report it. Do not dismiss the advisory solely because the patch is present.

Run the installed-patch regressions with:

```sh
node --test scripts/security/dependency-patches.test.mjs
```

Retain the patch and its lockfile hash in every fresh installation and Docker build. Replace it with a verified upstream fix when available. Dependency notices must be regenerated for the installed graph. Missing upstream notices are not silently cleared by these security changes.

These source changes do not update a running deployment. Deployments require separately authorized rebuild/update and runtime verification. No live financial database or backup is required for unit tests.

## Remaining-alert follow-up — 2026-10-15

Nodemailer is pinned to 10.0.9. A separate version-scoped override updates legacy `brace-expansion` 1.x to 1.1.21 without replacing its API with 5.x; the existing 5.0.12 override remains unchanged. Both checkouts retain the pinned `braces` depth/cycle mitigation and regenerate notices for the installed dependency graph.

The fresh lockfile audit reports one high advisory (`braces`) and zero critical, moderate or low advisories. This is a reduction from seven unique advisories, not a clean audit or a claim that GitHub alerts have already closed. No upstream fixed `braces` release exists; retain the mitigation and review its residual risk rather than dismissing the finding solely because a local patch is installed.

Run `node --test scripts/security/dependency-upgrades.test.mjs scripts/security/dependency-patches.test.mjs` for installed dependency checks: ordinary legacy expansion, bounded hostile patterns, malformed quoted-local-part parsing, offline notification generation, and the existing deep/cyclic AST protections. The tests use synthetic values and do not contact SMTP or a financial database.

## Earlier publication recheck — 2026-10-15 (superseded)

The exact updated lockfile passes a frozen installation. Patch regressions cover ordinary patterns, excessive parser nesting, caller-supplied deep/cyclic ASTs, and copying the patch into the Docker dependency layer before installation.

A fresh registry audit at that earlier checkpoint reported 5 high and 2 moderate advisories, with zero critical or low advisories. The reported packages were `brace-expansion`, `nodemailer` and `braces`. The remaining-alert follow-up above supersedes that count; the `braces` guard remains a local mitigation. Registry advisory results can change; rerun the audit for any release decision. This record does not waive source-notice or future binary-redistribution obligations.
