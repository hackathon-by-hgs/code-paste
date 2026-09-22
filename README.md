# Clipit backend — Control Plane

Clipit (the Cross-Device Clipboard) lets you copy on one machine and paste on another. It keeps
traffic local whenever the devices are local.

> **Status: early and in active development.** Built in public.

## Why

Moving a snippet from a laptop to a desktop sitting next to it shouldn't mean emailing yourself or
routing it through someone else's server. Two devices on the same desk shouldn't need a round trip
to a server to share a clipboard.

## Where this service fits

This repo is the **control plane**. It handles identity, the device registry, pairing,
authorization, share sessions and revocation. It decides *which* devices may talk to each other
and gives them signed peer rosters so they can check that for themselves.

It is **not** the clipboard data plane. No endpoint here accepts, relays or stores clipboard
content. Content moves between devices, never through this backend (ADR-001).

Docs, ADRs and contracts live on `main`. See `DEV_GUIDE.md` there for the branch layout, and
§3.2 for checking `main` out as a sibling worktree.

## Run it in under 5 minutes

```bash
cd backend
npm install
cp ../.env.example ../.env      # defaults work for local development
npm run contracts:pin           # fetch the pinned contracts from main
npm run test:all                # no database required — see below
npm run start:dev
```

### You do not need Docker to run the tests

Tests run against **PGlite** — real PostgreSQL compiled to WebAssembly, in process — using the
same schema and migrations as production. Set `DATABASE_URL` to run the identical suite against a
real PostgreSQL instead:

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev --name cp-pg postgres:17
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres npm run test:all
```

See `docs/ADR-007-PERSISTENCE.md` on `main` for why.

## Layout

```
backend/src/
├── auth/             identity, tokens, guards
├── users/            account entity and repository
├── devices/          registration, pairing, lifecycle, revocation
├── authorization/    THE authorization predicate + signed peer rosters
├── share-sessions/   explicit temporary sharing
├── protocol/         version negotiation and payload policy
├── realtime/         authenticated WebSocket control channel
├── rate-limiting/    layered abuse controls
├── observability/    redacting logger, metrics, request correlation
├── persistence/      schema, migrations, repositories, mappers
├── http/             filters, pipes, middleware
└── common/           ids, clock, crypto, errors
```

`http/` may call feature modules. Feature modules must not call `http/`. Features reach the
database only through repository interfaces. Enforced by ESLint in CI, not by convention.

## Checks

```bash
npm run format && npm run lint && npm run typecheck
npm run test:unit && npm run test:contract
npm run test:integration && npm run test:security && npm run test:e2e
npm run build
```

## Author

Built by [Faith Popoola](https://github.com/Maxima24).
