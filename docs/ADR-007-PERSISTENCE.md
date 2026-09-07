# ADR-007: PostgreSQL, Drizzle, Repositories and Mappers

## Status

Accepted.

Affects: `backend` only. No client-visible contract.

## Context

The control plane needs durable state for users, devices, keys, sessions, membership, refresh
tokens and pairing codes. `SYSTEM_DESIGN.md` §22 says start with Web/API/Database and add nothing
else without a measured bottleneck. `CLAUDE.md` requires persistence to sit behind an interface.

MongoDB was proposed on the grounds that the workload is write-heavy.

## Decision

**PostgreSQL**, accessed through **Drizzle ORM**, behind **repository interfaces**, with explicit
**mappers** at both boundaries.

### Why not MongoDB

The write-heavy premise does not hold for this service:

- **Clipboard payloads never reach the database.** They move agent-to-agent over the LAN
  (ADR-001, `SYSTEM_DESIGN.md` §5). The high-volume write path that would favour a document store
  is, by design, not in this system at all.
- **Actual write volume** is a login, an occasional token rotation, a rare device registration and
  a few session operations — single-digit writes per user per day.
- **The invariants are multi-record and security-critical.** "Revoke a device → destroy its token
  families → bump every affected roster version" must be atomic, or a revoked device keeps a live
  refresh token. Mongo can do multi-document transactions, but only on a replica set: *more*
  infrastructure than one Postgres, not less.
- **Foreign keys matter here.** Delete a user in Mongo and their `share_members` rows survive as
  orphans. Stale membership is stale authorization — a security bug, not untidiness. The prompt and
  `SPEC_CONTRACT.md` §16 both say to use database constraints where they enforce real invariants
  rather than relying on application code.

Against the spec's own decision hierarchy (security → correctness → simplicity), Postgres wins on
all three. Recorded as the rejected alternative rather than dismissed.

The one plausibly write-hot field is `devices.last_seen_at`. That is solved by **coalescing**
(§ below), not by changing database — a heartbeat write per device per 5 minutes is nothing.

### Layering

```
Controller / Gateway   transport only: parse, delegate, format
        │
Application service    business rules, transactions, authorization
        │
Repository interface   domain-typed port, defined in the domain layer
        │
Drizzle repository     the only code that knows about SQL or table shapes
        │
PostgreSQL
```

**Repositories** are declared as interfaces (`DeviceRepository`, `UserRepository`,
`ShareSessionRepository`, `RefreshTokenRepository`, `PairingCodeRepository`) and injected by token.
Services depend on the interface, never on Drizzle. Swapping the store — including to Mongo, if
that decision is ever revisited — is one adapter, not a rewrite.

**Mappers** are pure functions at two distinct boundaries, and conflating them is the mistake this
separation exists to prevent:

| Mapper | Direction | Responsibility |
|---|---|---|
| `DeviceMapper.toDomain` | row → domain | Widen DB row into the domain entity |
| `DeviceMapper.toPersistence` | domain → row | Narrow for insert/update |
| `DeviceMapper.toPublic` | domain → DTO | **Redaction boundary.** Decides what a client may see |

`toPublic` is where "never return private keys, hashes or internal ids" is actually enforced, in
one place, testable in isolation. Controllers never serialise a domain entity directly; a test
asserts that no response body contains a field outside the public projection. Because mappers are
pure, the entire mapping layer is unit-testable with no database at all — which is also why they
make the rest of the tests simple.

### Transactions

Every multi-record state change runs in one transaction: device registration (consume code +
insert device + issue tokens + bump rosters), device revocation, session join, member revocation,
refresh rotation. `runInTransaction` is provided by the persistence layer, and repositories accept
an optional executor so a service can compose several repositories inside one transaction without
the repositories knowing about each other.

### Heartbeat coalescing

`last_seen_at` is written at most once per device per `DEVICE_HEARTBEAT_COALESCE_SECONDS`
(default 300). The guard is a `WHERE last_seen_at IS NULL OR last_seen_at < now() - interval`
predicate in the UPDATE itself, so it costs one indexed write attempt and needs no read, no cache
and no lock.

### Test database

No Docker or Postgres is guaranteed on a developer machine, and CI must not be the only place tests
can run. Tests therefore run against **PGlite** — real PostgreSQL compiled to WebAssembly, in
process — using the **same schema and the same migrations**. When `DATABASE_URL` is set (CI, or a
local container) the identical suite runs against real PostgreSQL instead.

Verified as real Postgres, not an emulator: foreign keys, unique indexes, `ON DELETE CASCADE` and
transaction rollback all enforce correctly under PGlite (PostgreSQL 18.3). This matters — a mock or
an in-memory fake would let exactly the constraint bugs we care about slip through, since the
constraints *are* part of the security model.

## Consequences

### Positive

- Security invariants enforced by the database, not by hopeful application code.
- Integration tests run with zero infrastructure, and unchanged against real Postgres in CI.
- Storage is swappable; mappers make the redaction boundary a single testable surface.

### Negative

- Two drivers to keep working (`pg` and PGlite). Mitigated: one Drizzle schema, one migration set,
  one repository implementation — only the connection differs, and CI runs both.
- Drizzle is a younger dependency than an established ORM. Accepted: it is SQL-first with a small
  surface, and repository interfaces contain the blast radius.

## Rejected alternatives

**MongoDB** — see above. **Prisma**: heavier, code-generation step, larger attack surface.
**Raw `pg` with hand-written SQL**: no typed schema, more room for injection mistakes, more
migration bookkeeping. **SQLite**: lighter, but diverges from the production engine in exactly the
areas being tested (types, concurrency, constraint behaviour).
