# Recovered notice provenance

Reviewed 2026-10-07. These records explain why specific upstream notices are retained without inventing a copyright holder, changing dependencies, or treating a neighboring release as proof by itself.

## Better Auth utilities 0.5.0

The release tag resolves to `f03c1c76aff7bfa3f4de4af47b112315c770a0d1`. The official project later added its full MIT LICENSE at `ef522888b7b2ff77ca13f0afb476dfae8f297862` through [merged upstream PR 34](https://github.com/better-auth/utils/pull/34). Its manifest still names `@better-auth/utils` version `0.5.0`, author Bereket Engida and MIT license. The [official comparison](https://github.com/better-auth/utils/compare/f03c1c76aff7bfa3f4de4af47b112315c770a0d1...ef522888b7b2ff77ca13f0afb476dfae8f297862) changes only LICENSE and package.json, not the source files. Retained [notice](upstream/better-auth-utils-0.5.0-LICENSE.txt) is the authentic later upstream text for unchanged source, not a claim that the original archive contained it.

Version 0.4.2's source differs from that revision. It remains flagged; this 0.5.0 provenance is not automatically extended to it.

## React remove scroll bar 2.3.8

The npm gitHead `b3b1287aad81def2e2ae707274b74531b61ddbaf` could not be resolved. Instead, the exact 2.3.7 and 2.3.8 published archives were each downloaded and checked against their official SHA-512 integrity. All 25 `dist/` and `constants/` files and README are byte-identical. Only the root package.json differs. Full file hashes and both integrity values are retained in the [comparison record](upstream/react-remove-scroll-bar-2.3.8-provenance.json).

Upstream's [license-only addition](https://github.com/theKashey/react-remove-scroll-bar/commit/7301c160fda44cb8cf2b9fdfde61efad35736196) has the verified v2.3.7 source revision `29e9fcd1eecf7d3b77a767941c4a57fe461fc1e4` as its parent. The [retained MIT notice](upstream/react-remove-scroll-bar-2.3.8-LICENSE.txt) therefore comes from an authentic upstream addition for the same distributed code, not an assumed license from merely a nearby version. This does not make the unresolved gitHead available or rewrite release history.

## imurmurhash 0.1.4

The installed matching-version package contains its complete original copyright, permission and warranty text in README under a setext `License (MIT)` heading. The collector currently recognizes ATX headings, so it missed that section. The supplemental [notice](upstream/imurmurhash-0.1.4-LICENSE.txt) preserves that complete section verbatim. No source code, generic template or guessed attribution is substituted.

## Next packages

The `@next/eslint-plugin-next@16.3.5` and `eslint-config-next@16.3.5` supplements retain the official [matching-tag root MIT notice](https://github.com/vercel/next.js/blob/v16.3.5/license.md). The three locked `@next/swc-*` platform packages at 16.3.4 retain Next's existing matching-tag notice. This supplies their top-level package attribution only: SWC's embedded Rust/native components still need exact-artifact review. Next's license is not substituted for `client-only` or `server-only` original attribution.

## Unresolved or conflicting evidence

No verified original notice was obtained for `client-only@0.0.1` or Next's vendored `server-only@0.0.1`. The publisher/source clarification drafts remain unsent.

Development/build dependencies still flagged by the regenerated inventory remain open. In particular, `drizzle-kit@0.31.10` declares MIT while the matching `drizzle-kit@0.31.10` repository tag (`4aa6ecfee4b4728dadf6f77f071a149878a3c6c0`) supplies a root Apache-2.0 LICENSE and no kit-specific LICENSE. That conflict is recorded, not silently resolved by borrowing Drizzle ORM's license. README author names or license-name links alone are not treated as complete permission notices.
