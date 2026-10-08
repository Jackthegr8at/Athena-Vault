# Third-party notices

Athena Vault's own software is AGPL-3.0-only. Third-party software and fonts keep their upstream licenses; the project license does not replace them.

## Artwork and fonts

Application artwork is covered by [CC BY-SA 4.0 and the asset inventory](ASSET_LICENSE.md). Private mockups and unused images are excluded. Bundled Archivo and Playfair Display fonts remain under SIL OFL 1.1; their full copyright and license notices are stored beside the font files:

- [Archivo](apps/web/public/fonts/archivo-OFL.txt)
- [Playfair Display](apps/web/public/fonts/playfair-display-OFL.txt)

## Dependency documents

[Collected npm notices](third-party/npm-notices.txt) retain upstream license/copyright/NOTICE texts, including nested vendor and compiled-package notices. Identical texts are grouped without removing their package/file attribution. [The inventory](third-party/npm-inventory.json) records the exact lockfile hash, package versions, license metadata, installed status, and document hashes.

[Supplemental notices](third-party/supplemental-notices.json) identify pinned upstream texts for packages that omit them from their npm archive. Drizzle ORM 0.45.2's Apache license is sourced from its matching upstream tag; Postgres.js 3.4.9 declares Unlicense, whose standard text is included. The Next.js 16.3.4 MIT notice from its exact upstream tag also covers its `@next/env` package.

Regenerate after a frozen-lockfile dependency installation:

```sh
node scripts/generate-third-party-notices.mjs --root .
node scripts/generate-third-party-notices.mjs --root . --check
```

The collector uses installed packages and the lockfile, needs no new dependencies, and never installs packages or accesses the network. Docker's development, build and migration stages regenerate notices for their installed target-platform packages; the runtime image receives the build-stage notices and project licenses. Font notices travel with public assets.

The collector also retains complete permission/warranty text embedded under a README license heading and files named `THIRD-PARTY-NOTICES`. A README containing only a license name/link is still flagged. Exact upstream revisions provide additional original notices for esbuild, Rollup, unrs-resolver, franc and saxes; native libvips supplements preserve its component table and LGPL/GPL texts. Sources and revisions are recorded in the supplemental manifest; no author or copyright holder is invented.

## Coverage and release review

This is an inventory, not a declaration that every dependency is AGPL-compatible or redistributable. Check entries with no declared license or no notice before distributing them. Noninstalled lockfile entries include optional platform packages and must be checked if they enter the shipped artifact; their absence from a local installation is not a license approval.

The 2026-10-07 cleanup removes 20 unused version-scoped preset dependency edges and all 27 `@univerjs-pro/*` packages from the lockfile without adding/upgrading packages. A fresh frozen-lockfile installation and production build retain the root factory and sheets-core integration, with no Pro packages installed or found in generated JavaScript/JSON. Existing caches are not pruned. See the [artifact review](third-party/runtime-notice-review.md) for standalone version/notice coverage and remaining browser/native/container boundaries. Do not infer permissions from npm availability or a neighboring package's Apache license.

`@univerjs/telemetry` lacks a license field in its package manifest but includes an Apache 2.0 LICENSE, which the collector preserves. Missing metadata is not the same as a missing license document; review the actual document and any relevant notices.

`client-only@0.0.1` is included in the inspected standalone output and declares MIT, but its release has no copyright or permission text, author, or repository field. Its React homepage is not a copyright statement. The [exact artifact provenance and unresolved action](third-party/client-only-0.0.1-review.md) document this gap; the inventory continues to flag it. Do not invent a package-specific Meta/Vercel copyright line or treat a community discussion as maintainer confirmation. Obtain an original notice/upstream clarification or a qualified review of a documented attribution policy before distribution.

Also retain notices and satisfy source/redistribution obligations for native libraries and container-base software included in each final artifact. The npm inventory does not cover operating-system packages. Review the final source payload, standalone output, and Docker images separately; generated notice collection alone does not close the publication rights gate.

The isolated target Docker builds, actual emitted browser/server chunk review and Linux native smoke test are recorded in the artifact review. See the [native/container review](third-party/native-redistribution-review.md) for remaining corresponding-source and component-notice obligations, and the [unsent upstream requests](third-party/upstream-notice-requests.md) for authentic notices that still cannot be obtained locally.

Additional exact-version evidence now retains the complete `imurmurhash@0.1.4` README notice, Next 16.3.5 ESLint-package notices, Next 16.3.4 SWC top-level notice, and authentic later upstream notices for unchanged Better Auth utilities 0.5.0 and byte-identical scroll-bar code. See the [provenance review](third-party/recovered-notice-provenance.md); these are not invented historical notices. SWC's own MIT notice does not settle its vendored Rust/native components.

Node 22.15.1's complete bundled-license collection and pnpm 10.12.4's primary notice are also retained. The [native source manifest](third-party/native-source-manifest.json) pins the tested Alpine and libvips source references. It is not a corresponding-source delivery bundle, and it does not clear prebuilt-image redistribution. Current evidence belongs to the tested platform/versions; refresh it for any final artifact that differs.
