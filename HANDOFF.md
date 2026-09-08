# Handoff — backend

## Agent

`principal-engineer / control-plane`

## Date

2026-09-07

## Milestone

Control plane implemented: identity, device registry, authorization, share sessions, revocation,
signed peer rosters, realtime control channel, abuse controls.

## Objective

Deliver the backend domain as a production-quality implementation another team can integrate
against without discovering missing contracts later — and close the backend-owned gaps that
`docs/SPEC_CONTRACT.md` §20 recorded as unresolved.

---

## Completed

- **Identity** — signup, login, refresh with rotation and reuse detection, logout, `me`.
  Argon2id passwords, HS256 access tokens (10 min), opaque rotating refresh tokens stored as
  SHA-256 hashes. Two principal kinds (`browser`, `device`) that are not interchangeable.
- **Device registry** — pairing codes, registration with an Ed25519 public key, list, inspect,
  rename, pause/resume sync, revoke, delete, coalesced heartbeats.
- **Authorization** — one `AuthorizationService` owning the predicate. Signed, short-lived peer
  rosters (`GET /v1/authz/peer-set`) plus public verification keys (`GET /v1/authz/roster-keys`).
- **Share sessions** — create, list, inspect with membership, join by code, leave, revoke member,
  expire. Server-capped TTLs.
- **Protocol** — version negotiation, unsupported versions rejected loudly, authoritative payload
  limits published in both `/v1/protocol` and every roster.
- **Realtime** — authenticated bidirectional WebSocket at `/v1/realtime`, carrying authorization
  state changes only. Connection caps, message-size cap, per-connection rate limit,
  malformed-message throttling, heartbeats.
- **Abuse controls** — layered per-surface rate limits with exponential backoff on credential
  surfaces; body-size cap; connection and message caps.
- **Persistence** — PostgreSQL via Drizzle behind repository ports, with explicit mappers.
  Migrations, foreign keys, unique indexes, transactions. Retention sweep for expired material.
- **Observability** — structured logging with an allowlist redactor, safe metrics, request
  correlation ids.
- **Contracts** — schemas, OpenAPI and vectors authored on `main` (PR #1) and pinned here.

## Files changed

Everything under `backend/` (including `Dockerfile`, `docker-compose.yml` and `DEPLOYMENT.md`),
plus `.github/workflows/backend-ci.yml`, `.env.example`, `CONTRACTS_VERSION`, `CLAUDE.md`,
`README.md` and this file at the branch root.

## Architecture decisions

Recorded as ADRs on `main` (PR #1):

| ADR | Decision |
|---|---|
| 003 | Signed peer roster distribution — closes gaps #4 and #7 |
| 004 | Authentication and token semantics — closes gap #6 |
| 005 | Device pairing protocol — closes gap #5 |
| 006 | Realtime control channel |
| 007 | PostgreSQL, Drizzle, repositories and mappers (MongoDB recorded as the rejected alternative) |
| 008 | API and protocol versioning — closes gap #8 |

---

## Tests run

```
npm run format
> Checking formatting...
> All matched files use Prettier code style!

npm run lint
> eslint "src/**/*.ts" "test/**/*.ts"
> (no output — clean)

npm run typecheck
> tsc -p tsconfig.json --noEmit
> (no output — clean)

npm run build
> tsc -p tsconfig.build.json
> dist/main.js

npm run test:all
Test Suites: 21 passed, 21 total
Tests:       245 passed, 245 total
Time:        57.3 s, 5 projects
```

Breakdown: unit · contract conformance · integration · security · e2e.

CI run [`34168080823`](https://github.com/hackathon-by-hgs/code-paste/actions/runs/34168080823) —
**all five jobs green**:

```
✓ format · lint · typecheck · build
✓ tests (pglite)
✓ tests (postgres)
✓ dependency audit
✓ no secrets committed
```

**Verified against real PostgreSQL both ways**: in-process PGlite (PostgreSQL 18.3 — foreign keys,
unique indexes, cascades and transaction rollback all confirmed enforced) and a real PostgreSQL 17
service container in CI, running the identical suites.

---

## Security review

**Authentication.** Argon2id (19 MiB / t=2 / p=1). Login returns one indistinguishable
`invalid_credentials` for unknown account, wrong password and disabled account, with a dummy
verification on the absent-user path so timing does not leak existence. JWT verification pins
`algorithms: ['HS256']` and checks issuer and audience — `alg: none` and wrong-secret tokens are
rejected, with tests. Refresh tokens are single-use with reuse detection.

**Authorization.** One predicate in one service. HTTP and WebSocket call the same code; the
gateway has no database access and no second copy of any rule. Device-bound tokens are re-checked
against live device state on every request, so revocation does not wait for token expiry. Rosters
are bound to the requesting device, carry a monotonic `rosterVersion` for rollback detection, and
expire in 300 s — bounding residual access without any push infrastructure.

**Input validation.** Zod at every HTTP boundary, all schemas `.strict()` so unknown properties are
rejected rather than ignored. WebSocket frames are schema-validated against a closed message-type
enum. Ed25519 public keys are validated strictly (Node's lenient base64 would otherwise accept a
malformed key as a device identity). Pagination cursors are untrusted input and degrade to page one.

**Sensitive data handling.** Mappers are the single redaction boundary and construct their output
field by field, so a field added to a domain entity cannot leak by default. Tests assert that no
response contains a password hash, token hash, join-code hash, internal UUID or roster bookkeeping.

**Logging.** Allowlist-based redaction, plus a pattern scrubber for interpolated JWTs, PEM blocks
and long opaque tokens. A test drives a real request and asserts the password, both tokens and the
email never reach the log stream. `console` is banned by ESLint.

**Clipboard data.** No endpoint accepts, returns or stores clipboard content, and no realtime
message type can carry it. An e2e test moves a payload directly between two in-test agents and then
scans every table as text for a sentinel, so a future relay or debug column would fail the build.

### Bugs found and fixed during this work

1. **Reuse detection revoked nothing.** `revokeFamily` ran inside the transaction and the
   subsequent `throw` rolled it back, so a detected refresh-token theft left the attacker's freshly
   issued token working. Rejection paths now return an outcome from the transaction and the
   revocation is committed outside it. Caught by
   `test/security/hardening.spec.ts › treats reuse as theft and revokes the whole family`.
2. **Oversized bodies returned 500.** body-parser throws a plain `Error` carrying `.status`, not an
   `HttpException`, so hostile input produced an "unexpected error" instead of a deterministic 413.
3. **Revoked-device refresh reported `unauthenticated` instead of `device_revoked`**, losing the
   signal that tells a client to wipe its credentials.
4. **`drizzle-orm` < 0.45.2 carries a HIGH advisory** — GHSA-gpj5-g38j-94v9, SQL injection via
   improperly escaped identifiers. Caught by the `dependency audit` CI job on its first run;
   upgraded to 0.45.2 with no regressions. Flagged on `main` for any other domain adopting Drizzle.
5. **An empty environment variable was treated as invalid rather than unset**, so `DATABASE_URL=''`
   made the process refuse to start. "Set but empty" is the normal result of a shell default or a
   CI expression evaluating to `''` — and is exactly how the pglite CI leg failed. `loadConfig` now
   coerces empty and whitespace-only values to `undefined`.
6. **The `no secrets committed` job flagged its own fixture** — `redaction.spec.ts` contains a PEM
   header precisely to prove the scrubber removes it. Spec files are now excluded; a check that
   cries wolf on its own test is a check somebody deletes.

---

## Known limitations

1. **PGlite is single-threaded WebAssembly.** While it executes, the event loop is blocked, so a
   burst of truly simultaneous HTTP requests can reset a socket locally in a way real PostgreSQL
   does not. The pairing-race test therefore settles all requests and makes its authoritative
   assertion against persisted state. Keep that pattern for any new concurrency test.

   *(The original limitation here — "the production `pg` driver is unverified" — is now closed: the
   `postgres` CI leg runs every suite against a real PostgreSQL 17 service container and passes.)*
2. **`npm run test:all` has shown a rare flake.** One run failed two share-session tests in
   `hardening.spec.ts`; five subsequent runs of the same command passed 249/249, and the security
   suite passes in isolation every time. Unreproduced, so recorded rather than claimed fixed. Note
   that CI runs each project as a separate step and has never shown it. If it recurs, suspect
   PGlite timing under a long single-process run -- the same class of issue as the pairing-race
   ECONNRESET already worked around.
3. **Rate limiting and realtime state are in-process.** Correct for the single-instance MVP that
   `SYSTEM_DESIGN.md` §22 calls for; a second instance needs a shared limiter store and either
   sticky sessions or socket fanout. The roster TTL means a missed push is a latency issue, never a
   security one, so horizontal scaling degrades gracefully rather than becoming unsafe.
4. **Revocation has a bounded residual window** of one roster TTL (300 s default) for a device that
   is offline from the realtime channel. Stated and accepted in ADR-003; tune `ROSTER_TTL_SECONDS`.
5. **No password change or reset.** The `sv` (session version) claim is verified on every request
   and exists precisely to invalidate all outstanding tokens when that lands, but nothing bumps it
   today. Not in the OpenAPI contract, so it was out of scope rather than dropped.
6. **`/signaling/*` is deliberately unimplemented.** `API_CONTRACTS.md` says not to build it until
   the LAN transport needs it.
7. **Roster signing key rotation is supported but not automated.** Verifiers match on `keyId`;
   there is no rotation schedule or overlap window yet.
8. **`isSessionActive` exists twice** — once in TypeScript for the join path and once as a SQL
   predicate for the roster path. They must agree; both are covered by security tests, but a change
   to one needs a matching change to the other.

---

## Next agent should know

- **Do not add a message type to the realtime channel without reading ADR-006.** A contract test
  asserts the client and server enums match `realtime-envelope.schema.json` exactly, and another
  asserts no type name suggests clipboard content. That is the guard against the socket quietly
  becoming a relay.
- **Authorization changes belong in `AuthorizationService` only.** The gateway and the controllers
  both call it; adding a check to one path and not the other is the failure mode this structure
  exists to prevent.
- **Rejection paths must not revoke inside a transaction and then throw.** See bug #1 above.
- **Mappers are the redaction boundary.** Never serialise a domain entity into a response.
- **`.contracts/` is fetched, never committed.** Change a contract with a PR to `main`, a new tag,
  and a handoff — never by editing the pinned copy.
- Tests need no database. `npm run test:all` works on a clean machine; set `DATABASE_URL` to run
  the identical suites against a real server.

## Follow-up tasks

- [x] ~~Confirm the `postgres` CI matrix leg passes~~ — done; PR #1 merged, `protocol-v1.0.0`
      tagged at `83dfcc9`, and all five CI jobs are green.
- [ ] Add password change/reset, bumping `sv`; add it to the OpenAPI contract first.
- [ ] Shared rate-limit store and socket fanout before running more than one instance.
- [ ] Roster signing key rotation schedule with an overlap window.
- [ ] Decide whether `/v1/health` should be documented in the OpenAPI contract or stay
      deployment-internal (the conformance test currently exempts it explicitly).

## Integration notes

**Contract:** `CONTRACTS_VERSION` pins `protocol-v1.0.0`. The running server reports its pin at
`GET /v1/protocol` as `contractsVersion`, so drift between a deployment and its contract is
detectable at runtime.

**Blocking on `main`:** PR #1 must merge **and** `main` must be tagged `protocol-v1.0.0`
(`DEV_GUIDE.md` §5.4 puts tagging after the PR). Until then `npm run contracts:pin` fails with a
clear message and the contract-conformance CI job cannot run.

**For client domains** — response shapes for every endpoint, for both web and mobile, are in
`docs/CLIENT_RESPONSES.md` on `main`. The three things clients most often get wrong here:

1. **Serialise refreshes.** Two concurrent `/auth/refresh` calls with the same token trip reuse
   detection and log the user out. Use single-flight.
2. **Verify a roster in order**: signature over the exact bytes → parse → check `self.deviceId` is
   yours → check `rosterVersion` has not gone backwards → check `expiresAt`. Never parse first.
3. **Tolerate unknown response fields.** Additive changes ship inside `/v1` (ADR-008); a strict
   decoder will break on the next deploy.

**Environment:** every variable is in `.env.example` with a safe local default. Production refuses
to start without `DATABASE_URL` and `ROSTER_SIGNING_SECRET_KEY`, or with a placeholder JWT secret.

**A note on `DEV_GUIDE.md` §3.4:** the documented feature-branch convention cannot work. Git
refuses `refs/heads/main/<slug>` while `refs/heads/main` exists, and the same applies to
`backend/feat-x` now that `backend` exists. Raised in PR #1; suggested form is `<domain>--<slug>`.
