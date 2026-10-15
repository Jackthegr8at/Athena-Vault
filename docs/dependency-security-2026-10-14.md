# Dependency security maintenance — 2026-10-14

Security updates target the reported dependency graph, not application data or migrations.

- Next.js and its ESLint configuration: 16.3.8.
- Nodemailer: 10.0.2.
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

## Publication recheck — 2026-10-15

The exact updated lockfile passes a frozen installation. Patch regressions cover ordinary patterns, excessive parser nesting, caller-supplied deep/cyclic ASTs, and copying the patch into the Docker dependency layer before installation.

A fresh registry audit still reports 5 high and 2 moderate advisories, with zero critical or low advisories. The reported packages are `brace-expansion`, `nodemailer` and `braces`. This update is not a clean-audit claim: the `braces` guard is a local mitigation, and the remaining findings require follow-up review. Registry advisory results can change; rerun the audit for any release decision. This record does not waive source-notice or future binary-redistribution obligations.
