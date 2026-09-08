# Control Plane Web App

Next.js 16 (App Router) · React 19 · TailwindCSS v4 · pnpm · Vitest.

Talks to the control plane described by `contracts/openapi/control-plane.yaml` on `main`, pinned by
`CONTRACTS_VERSION`.

## Local development

```bash
pnpm install
cp ../.env.example .env.local   # then set NEXT_PUBLIC_API_URL
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

`NEXT_PUBLIC_API_URL` is the control-plane **origin only** — `/v1` is appended by
`src/lib/config.ts`. The app throws a named error rather than falling back to a default if it is
unset.

## Checks

```bash
pnpm exec tsc --noEmit   # typecheck
pnpm lint
pnpm test
pnpm build
```

## Docker

```bash
docker build -t clipit-frontend \
  --build-arg NEXT_PUBLIC_API_URL=https://code-paste.onrender.com .

docker run --rm -p 3000:3000 clipit-frontend
```

Or with compose, which declares the arg for you:

```bash
docker compose up --build
```

### The image is environment-specific

`NEXT_PUBLIC_*` variables are **inlined into the client bundle at build time**, so the backend URL
is frozen when the image is built — it cannot be changed with `-e` at `docker run`. Promoting one
image from staging to production would leave production talking to the staging API.

**Build one image per environment.** The build fails fast if the arg is missing, rather than
producing an image whose first API call throws.

### Image details

Multi-stage build on `node:22-alpine`, matching the Node version CI builds against. The final stage
carries only `output: "standalone"` — a minimal `server.js` plus the `node_modules` actually reached
at runtime. No pnpm, no sources, no tests, and `.dockerignore` keeps every `.env*` file out of the
build context. Runs as non-root (`nextjs`, uid 1001) with a `HEALTHCHECK` on `/`. ~286 MB.
