# syntax=docker/dockerfile:1
#
# One multi-target Dockerfile for the whole app:
#   * `backend` target — the Fastify API, run straight from TypeScript with tsx.
#   * `web` target      — nginx serving the built SPA and proxying /api/ to the
#                         backend (the SPA is `ssr: false`, so it's static).
# docker-compose builds both targets from this file.

# ---------------------------------------------------------------------------
# base — Node 22 (matches package.json `engines`) with corepack-managed pnpm.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH="/pnpm:$PATH" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# corepack activates the pnpm version pinned in package.json's `packageManager`.
RUN corepack enable

# ---------------------------------------------------------------------------
# deps — install the whole workspace from the frozen lockfile. Manifests are
# copied first so this layer stays cached until a package.json or the lockfile
# changes. `onlyBuiltDependencies` (root package.json) pre-approves the
# better-sqlite3 / esbuild native build scripts under pnpm v10; they compile /
# fetch prebuilt binaries for *this* image's platform here.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/content/package.json packages/content/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build — produce the static client SPA at apps/frontend/build/client.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter logarithmic-frontend run build

# ---------------------------------------------------------------------------
# web — nginx serves the SPA and reverse-proxies the API. Public entrypoint.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/build/client /usr/share/nginx/html

# ---------------------------------------------------------------------------
# backend — the Fastify API. No compile step: tsx runs the TypeScript directly,
# matching the dev command minus --watch. Reachable only via the web proxy on
# the compose network. Data (SQLite + images) lives under /data (a volume).
# ---------------------------------------------------------------------------
FROM deps AS backend
COPY . .
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/logarithmic.db \
    IMAGES_PATH=/data/images
WORKDIR /app/apps/backend
EXPOSE 3001
CMD ["node", "--import=tsx", "src/index.ts"]
