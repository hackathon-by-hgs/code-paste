# syntax=docker/dockerfile:1
#
# Production image for the control-plane web app.
#
# IMPORTANT — this image is environment-specific, not promotable.
# `NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time, so the
# backend URL is frozen when the image is built. Promoting one image from
# staging to production would point production at the staging API. Build one
# image per environment:
#
#   docker build -t clipit-frontend --build-arg NEXT_PUBLIC_API_URL=https://code-paste.onrender.com .
#   docker run --rm -p 3000:3000 clipit-frontend
#
# Node 22 matches the version the CI pipeline builds against.

ARG NODE_VERSION=22-alpine

# --- base: toolchain shared by the install and build stages -------------------
FROM node:${NODE_VERSION} AS base
# Next's native binaries expect glibc symbols that musl does not provide.
RUN apk add --no-cache libc6-compat
# Honours the `packageManager` field in package.json rather than pinning twice.
RUN corepack enable
WORKDIR /app

# --- deps: install once, cached until the lockfile changes --------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile

# --- builder ------------------------------------------------------------------
FROM base AS builder

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Fail here rather than shipping an image whose first API call throws. The value
# cannot be corrected later — it is already compiled into the JS bundle.
RUN test -n "$NEXT_PUBLIC_API_URL" || { \
      echo "ERROR: --build-arg NEXT_PUBLIC_API_URL is required." >&2; \
      echo "       It is inlined into the client bundle and cannot be set at runtime." >&2; \
      exit 1; \
    }

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# --- runner: no pnpm, no sources, no build toolchain --------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# standalone omits these two by design; server.js serves them once present.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

ENV PORT=3000
# Without this the server binds loopback inside the container and no published
# port ever reaches it.
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# Uses node's global fetch rather than curl/wget, which the runtime image lacks.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# No shell: signals reach node directly, so the container stops promptly.
CMD ["node", "server.js"]
