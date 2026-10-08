# Upstream notice clarification drafts

These are unsent drafts. They contain no private deployment information. Posting a public issue or contacting a maintainer requires separate authorization.

## client-only 0.0.1

Suggested recipient: the upstream npm publisher or Next.js maintainers responsible for its compiled copy.

> We are preparing an application that includes `client-only@0.0.1`. Its npm metadata declares MIT, but the published archive contains only package.json, empty index.js and error.js, with no copyright or permission notice. Could you supply the original copyright and MIT permission text applicable to this exact version, and include it in the package or provide an authoritative reference? We do not want to infer ownership from its React homepage, publisher account or Next.js's separate root license.

See [exact artifact identity](client-only-0.0.1-review.md). No response or publisher approval has been obtained.

## Other emitted code with missing original notices

`@better-auth/utils@0.4.2` declares MIT. Its official release tag resolves to `b20329a32d78f1f9bcc088bbd6f982b28c4192f1`; the tag's package manifest matches the version, but no license file was found at that revision. The later notice for unchanged 0.5.0 source is retained with [verified provenance](recovered-notice-provenance.md), without extending that comparison to the different 0.4.2 source.

`react-remove-scroll-bar@2.3.8` now has an authentic retained upstream notice with [exact archive/code-equivalence evidence](recovered-notice-provenance.md). It no longer needs a draft request for a merely neighboring-version notice. Its unresolved gitHead is still disclosed.

> Could you provide the original copyright and permission notices applicable to these exact package versions, preferably included in their release archives or linked to a verified source revision?

Next's vendored `server-only@0.0.1` marker also requires separate attribution review; its presence was detected by the emitted server-chunk graph, outside the lockfile manifest census. Do not infer that Next's top-level license settles every vendored package's attribution.

## Drizzle Kit 0.31.10 license discrepancy

Suggested recipient: Drizzle Kit's upstream maintainers.

> The exact npm release declares MIT, but the matching repository tag has an Apache-2.0 root LICENSE and no kit-specific license file. Could you identify the applicable license and original copyright/permission notice for drizzle-kit 0.31.10? We have not substituted the ORM/root license for the CLI package's declared terms.

No message was sent and no publisher response has been obtained.
