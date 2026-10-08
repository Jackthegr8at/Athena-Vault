# Dependency redistribution review

Reviewed 2026-10-07 against a fresh pnpm 10.12.4 frozen-lockfile installation, a Windows production build and isolated Linux x86-64 Docker builds. This records technical evidence and remaining rights gaps, not legal clearance.

## Install graph

The application uses `@univerjs/presets@0.25.1`'s root factory and the sheets-core preset. Version-scoped pnpm overrides remove its 20 unused preset dependency edges while retaining both entry points and the core/theme dependencies. The lockfile removes 82 packages, including all 27 `@univerjs-pro/*` packages; it adds or upgrades none. The fresh installation contains 617 packages and zero Pro packages. Old local caches are not pruned and are not evidence of the new installed graph.

The [regression tests](../apps/web/dependency-redistribution.test.ts) protect the pinned versions, removed edges, no-Pro lockfile and target-platform Docker notice generation. Workbook lifecycle tests and the production build verify the retained integration without replacing its factory or changing editor behavior.

## Inspected standalone artifact

The build contains 28 named/versioned package manifests. Zero Pro manifests or literal Pro references were found in its generated JavaScript/JSON. Manifest inspection is not a complete census of bundled code.

| Group | Manifests | Notice evidence |
| --- | ---: | --- |
| Athena workspace packages | 4 | Project AGPL license and package metadata |
| Other lockfile packages, excluding `client-only` | 17 | Matching version and nonempty documents in `npm-inventory.json` |
| Next vendored React/runtime packages | 3 | Next's harvested nested documents listed below |
| Next vendored Edge Runtime packages | 3 | Exact published archives' licenses match Next's harvested Edge Runtime license |
| `client-only@0.0.1` | 1 | Declared MIT; original notice absent, unresolved |

Next 16.3.4's collected nested notices cover these versioned vendored manifests even though they are not separate lockfile entries:

- `react-is@19.3.0-canary-cbb046ab-20260731`: `dist/compiled/react-is/LICENSE`
- `react-refresh@0.12.0`: `dist/compiled/react-refresh/LICENSE`
- `regenerator-runtime@0.13.4`: `dist/compiled/regenerator-runtime/LICENSE`
- `@edge-runtime/cookies@6.0.0`, `@edge-runtime/ponyfill@4.0.0`, and `@edge-runtime/primitives@6.0.0`: `dist/compiled/edge-runtime/LICENSE`

For each Edge Runtime package, the exact [official registry](https://registry.npmjs.org/) version metadata supplied the archive URL and SHA-512 integrity. Each downloaded archive matched that integrity and its complete license text matched the harvested Edge Runtime license. The normalized, trailing-whitespace-trimmed license SHA-256 is `b833af2b059af65fc49f5f806605f69ab7807d9ec89f62ef13cb5e7ca01743dd`. These are actual upstream notices, not inferred permissions from Next's own MIT license.

## Remaining review boundaries

- [client-only's exact upstream notice gap](client-only-0.0.1-review.md) remains a release blocker. No attribution is invented or generic license template substituted.
- The fresh Windows inventory has 773 locked / 617 installed packages, 156 noninstalled entries, one undeclared license field (`@univerjs/telemetry`, whose Apache LICENSE is retained), and 18 installed packages without harvested notices after the collector/supplement repairs. These counts include development/build dependencies; do not mistake a manifest check for approval of every package.
  The later 2026-10-07 notice follow-up reduces the fresh/candidate Windows missing-notice count to **12** (773 locked / 617 installed unchanged); private installation has 605 installed and 12 missing notices. The earlier Linux count of 19 is historical evidence and has not been rerun against the new supplements. See the provenance section below. No dependency version or lockfile was changed by this follow-up.
- Container OS packages, pnpm/toolchain contents, native source/notice obligations and AGPL compatibility still need the rights review described below. Full notice retention is not itself a compatibility opinion.

## Actual emitted browser/server chunks

A diagnostic-only plugin in an ignored validation checkout observed Webpack's actual `compilation.chunkGraph` after emission, recursively visiting concatenated modules. Package identities came from the nearest source package manifest, not abbreviated pnpm directory names. This avoids the filtering of dependent modules in ordinary Webpack statistics. The synthetic build, TypeScript checking and standalone sanitization completed; the plugin was not added to application configuration or release sources.

| Compiler | Chunks | Distinct resource paths | Package identities | Missing original notice |
| --- | ---: | ---: | ---: | --- |
| Browser/client | 172 | 2,077 | 110 | `react-remove-scroll-bar@2.3.8` |
| Node/server | 67 | 1,607 | 57 | `@better-auth/utils@0.4.2`, `@better-auth/utils@0.5.0` |
| Edge/middleware | 2 | 147 | 5 | `@better-auth/utils@0.4.2` |

No compiler emitted an `@univerjs-pro/*` package. Next-vendored resources require their own notice review: Edge Runtime cookies are covered by the earlier verified notice, while the `server-only@0.0.1` marker needs attribution review. Runtime externals and native libraries are separate from this graph. These are Windows compiler artifacts for the frozen graph, not an authenticated browser session or cross-platform byte-for-byte equivalence claim. The [upstream request drafts](upstream-notice-requests.md) preserve unresolved exact-version provenance without substituting neighboring/current licenses.

### Later notice recovery for this unchanged graph

The [recovered-notice provenance](recovered-notice-provenance.md) establishes authentic notices for `@better-auth/utils@0.5.0` and `react-remove-scroll-bar@2.3.8`. The compiler table above records what was missing at its inspection time; those two notice gaps are now resolved through verified upstream additions and source/code equivalence. `@better-auth/utils@0.4.2`, `client-only`, and the separately vendored `server-only` marker remain unresolved. Additional supplements preserve imurmurhash's full original README notice, matching Next ESLint notices and SWC's top-level Next notice. SWC embedded components are not cleared by its top-level notice.

The unchanged chunk graph was not rebuilt merely to add notice files. Inventory `--check` verification is separate from exact-image acceptance. The currently built images also predate these additions; Docker's existing notice-directory copy will carry them in a subsequent build, but that is not a claim that the new images have been built or approved.

## Target Docker/native checks

The authorized Docker host supplied the unavailable Linux engine. Unique scratch images for development, migration and runtime were built from a source-only allowlisted archive, without private environment files or Git history. Each target generated/received its target-platform notices; the Linux build dependency inventory contains 773 locked / 624 installed packages and no Pro packages. Updated notice retention and native supplements are checked on those targets separately from license approval.

The runtime's Sharp 0.35.4/libvips 8.18.6 successfully generated a 91-byte PNG. Test containers had no host mounts or external networking and used a read-only filesystem, dropped capabilities and no-new-privileges. Existing Athena service container identities were checked separately; none was deployed, restarted or migrated. This does not validate database-backed flows.

The native [component/source and container-base review](native-redistribution-review.md) records retained LGPL/GPL texts, upstream component attribution, 20 runtime APK packages and the presence of Node's base-image license. Corresponding-source delivery, component-specific notices, OS/toolchain review and replacement/relinking acceptance are **not** complete. The checks are now executed with explicit findings, rather than marked unverified because Docker was unavailable; public redistribution remains blocked on those findings.

The current local checks use synthetic configuration and do not access a live database, deploy an image, or authorize publication.
