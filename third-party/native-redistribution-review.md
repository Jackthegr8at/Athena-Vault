# Native/container redistribution review

Reviewed 2026-10-07. Build and execution checks are not legal clearance. Do not distribute a container until its notice and corresponding-source requirements are satisfied.

## Tested native library

The isolated Linux x86-64 Alpine runtime uses Sharp 0.35.4 and libvips 8.18.6. Creating a one-pixel PNG produced 91 bytes with external networking disabled, a read-only filesystem and no host mounts. This validates loading and execution, not replacement/relinking or source availability.

The two locked libvips Linux packages at version 1.3.3 declare `LGPL-3.0-or-later`. Their upstream build repository is pinned to commit `6e5971d333377743163edc3ad9e5d0b897abcbc9`. The [retained native notices](upstream/sharp-libvips-1.3.3-NOTICES.txt) contain that revision's complete component-license table and the standard LGPL/GPL version 3 texts from SPDX. The npm archive omits a full license file. The supplemental inventory now retains these documents when the matching native package is installed.

- [Exact component-license table](https://github.com/lovell/sharp-libvips/blob/6e5971d333377743163edc3ad9e5d0b897abcbc9/THIRD-PARTY-NOTICES.md)
- [Exact build source and version recipes](https://github.com/lovell/sharp-libvips/tree/6e5971d333377743163edc3ad9e5d0b897abcbc9)
- [LGPL version 3](https://spdx.org/licenses/LGPL-3.0-or-later.html)

The table includes LGPL libraries, MPL-licensed Cairo and other individually licensed components. A license-name table and generic LGPL text do not contain every component's copyright notice. Before redistributing these binaries, retain the component-specific notices, archive the required exact source/build materials and provide a compliant source-delivery method. Review the applicable LGPL combined-work/replacement requirements rather than assuming that a dynamically loaded shared library alone satisfies them. No corresponding-source archive or relinking/replacement acceptance test has been completed here.

## Container base and tools

The tested base is the repository's pinned Node 22.15.1/Alpine 3.21 digest. `/usr/local/LICENSE` is present. Runtime APK metadata identifies 20 installed packages and preserves origin and aports build-commit identifiers. Important separate obligations include GPL packages (BusyBox, apk-tools, Alpine baselayout, scanelf and musl-obstack), GCC runtime libraries, musl, OpenSSL, certificate data and gcompat. Package metadata alone does not supply their complete notices or corresponding source. Review the exact aports recipes, patches, source checksums and any runtime-library exceptions before image publication.

Development and migration images additionally include pnpm and build/development dependencies. Their successful notice regeneration is not approval of packages still flagged `missingNotice`. Global tools and Node-vendored libraries are not covered by the lockfile collector; inspect their shipped license collections separately. The runtime image does not inherit the pnpm-bearing base stage.

### Retained exact-version evidence

The [Node 22.15.1 complete upstream license collection](upstream/node-22.15.1-LICENSE.txt) is now retained in the source payload and therefore in the Docker notice directory. Its SHA-256 is `1ae62e2015784ba438db7b04ebd33f3c4ff3efdb824c111c4ececd99945fd52d`, identical to `/usr/local/LICENSE` inspected in the earlier runtime. This includes Node's bundled component notices, not only Node's own MIT text. The [pnpm 10.12.4 original primary notice](upstream/pnpm-10.12.4-LICENSE.txt) is retained separately; it does not replace notices for pnpm's bundled modules or native tools.

The [native source manifest](native-source-manifest.json) records all 20 APK identities across 14 origins, each exact aports recipe URL/build commit and the verified recipe SHA-256. Every recipe resolved at its recorded commit. It also records 28 libvips component versions from the SHA-512-verified `@img/sharp-libvips-linuxmusl-x64@1.3.3` archive and the exact build-recipe revision/hash. The inventory includes component versions, not an assertion that every component or its transitive dependencies have complete notices. No upstream recipe was executed.

This manifest is **not** a corresponding-source archive or a written source offer. Before distributing a prebuilt image, preserve the exact sources, local patches/configuration, build recipes and applicable notices; select a compliant delivery method and test recipient access. For LGPL components, test the applicable replacement/relinking arrangement against the exact distributed application. The recipe includes external patches and component dependencies that must not be omitted. APK packages added during builds are not version-pinned, so later images may require a different manifest even when the Node base digest is unchanged.

### Source-only versus binary publication

The current preparation plan concerns a fresh source repository. Its allowlisted payload excludes installed dependencies, `.next`, standalone bundles and Docker images; Dockerfiles describe local builds, not a public prebuilt-image release. Keep that distinction explicit in acceptance evidence. Any later distribution of generated browser code, standalone archives or images needs its own exact-artifact notice/source review. This distinction does not waive the unresolved notice gaps or declare either release approved; source-only review and binary-distribution approval must be recorded separately.

## Release boundary

The technical build/native checks are now executed, not merely deferred because the Windows Docker engine is unavailable. The **redistribution rights gate remains open** for native component attribution/source delivery, OS/toolchain review and the package gaps listed in the [artifact review](runtime-notice-review.md). No image was published or deployed, and no production database or volume was used.
