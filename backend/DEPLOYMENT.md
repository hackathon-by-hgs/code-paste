# Deploying the control plane

## What this is

A small HTTP + WebSocket service. **Clipboard payloads never pass through it** (ADR-001), so its
load scales with the number of devices, not with how much anyone copies. One modest instance plus
a PostgreSQL database is the entire production footprint.

> **Before you deploy for real:** the `desktop` and `shared` branches do not exist yet. You can
> deploy this today and the web app can manage accounts, devices and sharing against it — but
> nothing syncs a clipboard until a native agent ships. Deploying now is useful for integration,
> not for a working product.

## Requirements

| | |
|---|---|
| Runtime | Node ≥ 22 |
| Database | PostgreSQL 14+ (managed is fine; migrations run automatically at boot) |
| Proxy | Must forward WebSocket upgrades on `/v1/realtime`, and terminate TLS |
| Instances | **One** — see [Scaling](#scaling) |

## Configuration

Production refuses to start unless these are set correctly. That is deliberate: a misconfigured
control plane should fail loudly, not run insecurely.

```bash
NODE_ENV=production
DATABASE_URL=postgres://user:pass@host:5432/code_paste
AUTH_JWT_SECRET=<at least 32 characters, and not a placeholder>
ROSTER_SIGNING_SECRET_KEY=<32 raw bytes, base64>
PORT=3000
```

Generate the secrets once, per environment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # AUTH_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ROSTER_SIGNING_SECRET_KEY
```

Every other variable has a safe default; `.env.example` at the branch root documents all of them.

### CORS

```bash
CORS_ALLOWED_ORIGINS=https://code-paste-1.onrender.com
```

A comma-separated allowlist of **exact origins**. Scheme and port are part of the match, so
`http://` and `https://` of the same host are different entries. `*` is rejected at startup rather
than accepted as a permissive setting — it is indistinguishable from having no policy at all. A
malformed entry also stops the process, because an origin silently dropped at boot surfaces much
later as an inexplicable browser failure.

The default covers local development plus the deployed web app. **Set it explicitly per
environment**; a production API should not be carrying development origins.

**Web clients must not set `withCredentials` / `credentials: 'include'`.**
`Access-Control-Allow-Credentials` is deliberately off: authentication is a Bearer token the app
attaches explicitly (ADR-004), so there are no cookies and no ambient credentials for a cross-site
request to ride on. That is what makes this API structurally immune to CSRF, and turning
credentials on would give that up for nothing.

The **WebSocket handshake is exempt from CORS in the browser**, so `/v1/realtime` checks `Origin`
itself: absent (a native agent) is allowed; present must be on the same allowlist.

### How configuration is loaded

`npm start` and `npm run start:dev` read `.env` from the **branch root** using Node's built-in
`--env-file-if-exists`. There is no dotenv dependency, and no file is required — if `.env` is
absent, the app simply uses the real environment.

**A real environment variable always wins over `.env`.** That ordering is deliberate: a platform's
secret store or a container's environment must never be overridden by a file that happens to be
sitting in the image. In practice this means:

| Environment | Where configuration comes from |
|---|---|
| Local development | `cp .env.example .env` at the branch root, then `npm run start:dev` |
| Docker / compose | Real environment variables. `.env` is excluded by `.dockerignore` and never read |
| Managed platform | The platform's secret store, injected as environment variables |

### `ROSTER_SIGNING_SECRET_KEY` is durable infrastructure

Treat it like a database, not like a config value. Every peer roster in the field is signed with
it, and agents verify cached rosters against the matching public key. Lose or rotate it carelessly
and every agent's cached roster stops verifying: they fall back to "cannot authorize anyone" and
sync stops until each one re-fetches. That is why the app refuses to generate one in production —
a key regenerated on restart would silently break the fleet on every deploy.

Store it in a real secret manager. To rotate it deliberately, see [Rotating the signing
key](#rotating-the-roster-signing-key).

## Deploying with Docker

```bash
cd backend

export AUTH_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
export ROSTER_SIGNING_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

docker compose up --build
curl -s localhost:3000/v1/health     # {"status":"ok","driver":"postgres"}
```

`docker-compose.yml` runs PostgreSQL alongside the app and is intended for local and staging use.
In production, point `DATABASE_URL` at a managed database and run the image alone.

To build and run just the image:

```bash
docker build -t code-paste-control-plane ./backend
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e AUTH_JWT_SECRET=... \
  -e ROSTER_SIGNING_SECRET_KEY=... \
  code-paste-control-plane
```

The image is multi-stage: the runtime layer carries the built artifact and production dependencies
only — no compiler, no tests, no source — and runs as the unprivileged `node` user.

## Deploying without Docker

Anywhere that runs a Node process: Fly, Railway, Render, an ECS task, or a VM with systemd.

```bash
cd backend
npm ci
npm run build      # emits dist/ and copies the SQL migrations into it
npm run smoke      # optional: boots the artifact and checks it serves
npm start          # node dist/main.js
```

**`npm run build` is not optional shorthand for `tsc`.** It also cleans `dist/` and copies
`src/persistence/migrations/*.sql` into the artifact. Running `tsc` directly produces a build that
starts and then dies on `scandir dist/persistence/migrations`.

## Reverse proxy

The app sets `trust proxy` to 1, so it reads the client address from `X-Forwarded-For` — which
means **it must sit behind exactly one proxy that you control**. Expose it directly, or behind two
unaware proxies, and a client can choose its own rate-limit bucket by forging that header.

WebSocket upgrades must be forwarded, or the realtime channel silently degrades to polling-only
behaviour (still correct — roster expiry remains the correctness floor — but revocation takes up
to a full TTL to reach agents instead of milliseconds).

nginx:

```nginx
location / {
    proxy_pass         http://control-plane:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;   # long-lived control sockets
}
```

## Health, migrations and restarts

- **Health:** `GET /v1/health` → `{"status":"ok","driver":"postgres"}`. Unauthenticated, and
  deliberately says nothing else about the deployment.
- **Readiness:** the server does not listen until migrations have applied, so a successful health
  response means the schema is current.
- **Migrations** run at startup, each inside a transaction, recorded in `_migrations`. They are
  idempotent and safe to re-run.
- **Restarts** are safe while a single instance is running. Rolling two instances through a
  migration is not — see below.

## Scaling

**Run one instance.** Two pieces of state are in-process:

- **rate limiting** — a second instance doubles every effective limit;
- **realtime connections** — an authorization event only reaches sockets on the instance that
  handled the change.

Neither is a security hole. The roster TTL is the correctness floor, so a missed push costs
latency, never authorization. But both must be addressed before scaling out:

1. Move rate-limit counters to a shared store.
2. Add sticky sessions, or fan authorization events out between instances.

This is a deliberate MVP position (`SYSTEM_DESIGN.md` §22: do not add infrastructure for
hypothetical scale). The control plane's traffic is a handful of requests per device per day, so
one instance goes a very long way.

## Rotating the roster signing key

Verifiers match on `keyId`, so rotation is supported — but there is no automated overlap window
yet. Until one exists, rotate during a maintenance window:

1. Deploy the new `ROSTER_SIGNING_SECRET_KEY`.
2. Agents fetch `GET /v1/authz/roster-keys`, see the new `keyId`, and re-fetch their roster.
3. Expect up to one roster TTL (300 s default) during which cached rosters fail verification and
   agents stop syncing.

Rotating `AUTH_JWT_SECRET` invalidates every outstanding access token immediately; refresh tokens
survive, so clients recover on their next refresh.

## Backups

Back up PostgreSQL normally. It holds accounts, device public keys, sharing membership and token
hashes — **no clipboard content, and no private keys**, by design. A restore to an earlier point
resurrects device authorizations that were revoked after it, so treat the backup window as the
outer bound on revocation durability.

## Security checklist before going live

- [ ] TLS terminated in front of the app; no plaintext listener exposed
- [ ] Exactly one trusted proxy in front (`trust proxy` is set to 1)
- [ ] `AUTH_JWT_SECRET` and `ROSTER_SIGNING_SECRET_KEY` from a secret manager, not from a file
- [ ] `NODE_ENV=production` (the app validates this and refuses placeholder secrets)
- [ ] Database reachable only from the app, not from the internet
- [ ] Log destination scrubs nothing extra — the app already redacts by allowlist, and logs no
      clipboard content because it never receives any
- [ ] `npm run audit:security` clean in the deployed commit
- [ ] Backups configured and a restore tested
