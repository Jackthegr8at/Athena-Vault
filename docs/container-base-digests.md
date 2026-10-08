# Container base image digests

This file records the authoritative, production-resolved external container image references for Athena Vault. Built operator images (`athena-vault-backup`, `athena-vault-db-tools`) must use an immutable local image ID (`sha256:<64-hex>`) obtained after building from the pinned base; their IDs are not recorded here because no production build was performed in this environment.

## Pinned base images

| Image | Tag | Pinned reference | Source evidence |
|---|---|---|---|
| `node` | `22.15.1-alpine3.21` | `node:22.15.1-alpine3.21@sha256:d1068d8b737ffed2b8e9d0e9313177a2e2786c36780c5467ac818232e603ccd0` | Docker Hub `registry-1.docker.io` OCI index `sha256:152270cd4bd094d216a84cbc3c5eb1791afb05af00b811e2f0f04bdc6c473602` retrieved 2026-09-02; amd64 image manifest `sha256:d1068d8b737ffed2b8e9d0e9313177a2e2786c36780c5467ac818232e603ccd0` confirmed via `docker-content-digest` |
| `postgres` | `18.4-alpine3.24` | `postgres:18.4-alpine3.24@sha256:b6a16ed0eb96e2c362811f7eeb951eac8b459e7b40be4149ea5444aa7c65569b` | Docker Hub OCI index `sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15`; amd64 image manifest `sha256:b6a16ed0eb96e2c362811f7eeb951eac8b459e7b40be4149ea5444aa7c65569b` confirmed |
| `caddy` | `2.10.0-alpine` | `caddy:2.10.0-alpine@sha256:f43d8810c944e27e6f7ea80b165de11dbdab16cff15c8a80d83ae3e1a109a35d` | Docker Hub OCI index `sha256:ae4458638da8e1a91aafffb231c5f8778e964bca650c8a8cb23a7e8ac557aa3c`; amd64 image manifest `sha256:f43d8810c944e27e6f7ea80b165de11dbdab16cff15c8a80d83ae3e1a109a35d` confirmed |

## Local image policy

- `ATHENA_BACKUP_IMAGE` and `ATHENA_DB_TOOLS_IMAGE` must be immutable local image IDs in the production environment (`sha256:<64-hex>`), obtained from `docker image inspect` after building from the pinned `POSTGRES_IMAGE`.
- A mutable local build tag is allowed only in explicitly local/development environment files, never in `docker-compose.prod.yml` or a production environment file.
- No tag-only or digest-only external image reference may reach production. `docker-compose.prod.yml` uses `${VAR:?...}` to enforce this.

## Signer / provenance note

No non-wildcard signer certificate identity, issuer, or pinned public-key checksum for these Docker Official Images was retrievable in this environment. The registry-level digests above were verified directly from `registry-1.docker.io`, but Docker Content Trust / cosign / TUF public-key evidence is not yet recorded. Do not deploy without separately verifying and documenting the approved signer identity or pinned public-key checksum here.

`scripts/security/image-provenance-local.sh` fails closed until the operator supplies exact, non-wildcard `COSIGN_CERTIFICATE_IDENTITY`/`COSIGN_CERTIFICATE_OIDC_ISSUER` values that match the approved counterparts, or a public key whose SHA-256 matches the approved checksum. The approved signer values and checksum remain intentionally unset pending independent verification.
