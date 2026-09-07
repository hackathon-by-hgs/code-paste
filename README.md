# backend — Control Plane

Identity, device registry, authorization, share sessions and revocation for the Cross-Device
Clipboard. **Not** the clipboard data plane: no endpoint here accepts, relays or stores clipboard
content.

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
