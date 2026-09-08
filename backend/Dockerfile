# syntax=docker/dockerfile:1

# Control plane image.
#
# Build context is `backend/`. Multi-stage so the runtime image carries no compiler, no test
# tooling and no source — only the built artifact and production dependencies.

# ---------------------------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Dependencies are installed from the lockfile before the source is copied, so a source-only
# change reuses the cached layer instead of reinstalling everything.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src

# `build` runs prebuild (clean) and postbuild (copy SQL migrations into dist/). tsc alone would
# emit no migrations and the container would die on startup.
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Stage 2 — production dependencies
# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# @electric-sql/pglite is a devDependency, but npm installs it anyway because drizzle-orm declares
# it as an *optional peer*. It is 25 MB of WebAssembly PostgreSQL that this image can never use:
# production refuses to start without DATABASE_URL, and both the client and its Drizzle driver are
# required lazily inside the branch that only runs when DATABASE_URL is absent. Removing it here
# is therefore safe, and is verified by the `docker` job in CI booting this image.
RUN rm -rf node_modules/@electric-sql

# ---------------------------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# The pinned contract tag, baked in at build time. CONTRACTS_VERSION lives at the branch root —
# one level above this build context — so a running container has no file to read and would report
# `contractsVersion: "unknown"`, quietly defeating the point of publishing the field at all.
#   docker build --build-arg CONTRACTS_VERSION="$(cat ../CONTRACTS_VERSION)" -t … .
ARG CONTRACTS_VERSION=unknown

ENV NODE_ENV=production \
    PORT=3000 \
    CONTRACTS_VERSION=${CONTRACTS_VERSION}

WORKDIR /app

# The base image ships an unprivileged `node` user. Running as root in a container that terminates
# untrusted network input is an unnecessary escalation path.
COPY --chown=node:node --from=deps  /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist         ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# Uses the app's own health endpoint. Node 22 has global fetch, so this needs no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are applied at startup, inside a transaction, before the server listens.
CMD ["node", "dist/main.js"]
