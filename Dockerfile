# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.15.1-alpine3.21@sha256:d1068d8b737ffed2b8e9d0e9313177a2e2786c36780c5467ac818232e603ccd0
ARG PNPM_VERSION=10.12.4

FROM ${NODE_IMAGE} AS base

ARG PNPM_VERSION

WORKDIR /workspace

ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apk add --no-cache libc6-compat \
    && npm install --global pnpm@${PNPM_VERSION} \
    && pnpm config set store-dir /pnpm/store

# Copy only workspace manifests before installing so dependency layers remain
# reusable when application source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/finance-engine/package.json packages/finance-engine/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validation/package.json packages/validation/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS development

ENV NODE_ENV=development

COPY . .

RUN node scripts/generate-third-party-notices.mjs --root /workspace

CMD ["pnpm", "--filter", "@athena/web", "dev", "--hostname", "0.0.0.0"]

FROM base AS build

ARG BETTER_AUTH_URL=http://localhost:3000
ARG ATHENA_AUTH_TRUSTED_ORIGINS=
ARG ATHENA_AUTH_TRUSTED_PROXY_IPS=none
ARG ATHENA_PASSKEYS_ENABLED=false

ENV NODE_ENV=production \
    DATABASE_URL=postgresql://athena_app:build-placeholder@postgres:5432/athena_vault \
    ATHENA_AUTH_DATABASE_URL=postgresql://athena_auth:build-placeholder@postgres:5432/athena_vault \
    BETTER_AUTH_URL=${BETTER_AUTH_URL} \
    ATHENA_AUTH_TRUSTED_ORIGINS=${ATHENA_AUTH_TRUSTED_ORIGINS} \
    ATHENA_AUTH_TRUSTED_PROXY_IPS=${ATHENA_AUTH_TRUSTED_PROXY_IPS} \
    ATHENA_PASSKEYS_ENABLED=${ATHENA_PASSKEYS_ENABLED}

COPY . .

RUN node scripts/generate-third-party-notices.mjs --root /workspace && pnpm --filter @athena/web build

FROM base AS migration

ENV NODE_ENV=production \
    HOME=/tmp

RUN addgroup --system --gid 1001 athena && \
    adduser --system --uid 1001 --ingroup athena athena

WORKDIR /workspace
COPY --chown=athena:athena . .

RUN node scripts/generate-third-party-notices.mjs --root /workspace

USER athena

CMD ["./packages/database/node_modules/.bin/tsx", "scripts/docker/migrate.ts"]

FROM ${NODE_IMAGE} AS runtime

WORKDIR /workspace

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache libc6-compat \
    && addgroup --system --gid 1001 athena \
    && adduser --system --uid 1001 --ingroup athena athena

COPY --from=build --chown=athena:athena /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=athena:athena /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=athena:athena /workspace/apps/web/public ./apps/web/public
COPY --from=build --chown=athena:athena /workspace/LICENSE /workspace/ASSET_LICENSE.md /workspace/THIRD_PARTY_NOTICES.md ./
COPY --from=build --chown=athena:athena /workspace/licenses ./licenses
COPY --from=build --chown=athena:athena /workspace/third-party ./third-party

USER athena

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
