# ADR-004: Authentication and Token Semantics

## Status

Accepted. Closes `SPEC_CONTRACT.md` gap #6.

Affects: `backend` (owner), `frontend`, `desktop`, `mobile`.

## Context

`API_CONTRACTS.md` says the authentication mechanism is "implementation-specific". That is fine as
far as it goes, but token **shape, lifetime and revocation semantics** are consumed by every client
domain, so they belong in a contract rather than in backend source code.

The governing requirement is `RULES.md` §2.6: revocation must take effect promptly. That single
line rules out the naive JWT setup, where a stateless access token remains valid until it expires
no matter what the server thinks.

## Decision

Email + password, with a **JWT access token** and an **opaque rotating refresh token**.

### Access token

- JWT, `HS256`, signed with `AUTH_JWT_SECRET` (≥32 bytes).
- **TTL 600s (10 minutes).** Short TTL is the mechanism that makes stateless verification
  compatible with prompt revocation. It bounds residual access without a database read per request.
- Claims: `sub` (user public id), `did` (device public id, **device tokens only**), `typ`
  (`browser` | `device`), `sv` (session version), `jti`, `iat`, `exp`, `iss`, `aud`.
- Verified with `clockTolerance: 30s` so ordinary clock skew is not an outage.

### Two principal kinds, deliberately not interchangeable

A **browser** token manages the account. A **device** token additionally acts as a clipboard peer.
Only a device token may fetch a peer roster, heartbeat, or open the realtime socket. Without this
split, stealing a web session would yield clipboard peer access, and a device compromise would
yield full account control. The `typ`/`did` claims are enforced in guards, not in controllers.

### Refresh token

- **Opaque**, 32 bytes from a CSPRNG, base64url. Not a JWT: it must be revocable, and revocable
  means server-side state, at which point a JWT buys nothing and only risks being trusted offline.
- Stored **only as a SHA-256 hash**. A database disclosure does not yield usable tokens.
  (SHA-256, not Argon2: the token is already 256 bits of CSPRNG entropy, so there is nothing to
  brute-force and a slow KDF would only add latency to every refresh.)
- TTL 30 days. Bound to a `familyId` and, for device tokens, to a `deviceId`.

### Rotation with reuse detection

Every refresh consumes the presented token and issues a new one in the same family, inside one
transaction. Presenting an **already-consumed** token means the token was captured and used by
someone — the legitimate holder and the attacker cannot both hold the latest one. The response is
`token_reused` and **the entire family is revoked immediately**, forcing re-authentication.

This is why refresh tokens are single-use: without rotation, a stolen refresh token is a 30-day
credential and its theft is undetectable.

### Revocation semantics

| Event | Effect on refresh tokens | Effect on access tokens |
|---|---|---|
| Logout | Presented family revoked | Expire naturally (≤10 min) |
| Refresh reuse detected | Family revoked | Expire naturally |
| Device revoked | **All families for that device revoked, transactionally** | Rejected immediately: the guard re-checks device state |
| Device deleted | All families revoked, then rows cascade | Rejected immediately |
| Password change | All families for the user revoked (`sv` bumped) | Rejected immediately on `sv` mismatch |

Device-bound access tokens are **not** purely stateless: the device guard checks the device's
current revoked/enabled state. This is a deliberate trade — one indexed primary-key lookup per
device request — because a revoked device that keeps syncing clipboard data for ten minutes is the
exact outcome `SECURITY.md` objective 4 forbids. Browser tokens stay fully stateless except for the
`sv` check.

### Passwords

- **Argon2id**, 19 MiB memory, 2 iterations, parallelism 1 (OWASP 2024 guidance), per-password
  random salt via the `argon2` library. Never a homegrown scheme (`RULES.md` §2.14).
- Minimum length 12; **no composition rules**, which reliably produce weaker, more predictable
  passwords.
- `POST /auth/login` returns `invalid_credentials` for unknown email, wrong password and disabled
  account alike, and always performs a verification (against a dummy hash when the user is absent)
  so response timing does not leak account existence.
- `POST /auth/signup` deliberately *does* return `409`, because signup is inherently an
  account-existence oracle and pretending otherwise costs usability while hiding nothing.

### Key management

`AUTH_JWT_SECRET` and `ROSTER_SIGNING_SECRET_KEY` come from the environment, are validated at boot
(the app refuses to start on a missing or too-short secret), and are never logged — the redaction
allowlist drops them, and a test asserts it.

## Consequences

### Positive

- Prompt revocation despite stateless-ish tokens.
- Refresh-token theft is detected rather than merely survived.
- Web-session compromise does not yield clipboard peer access.
- No third-party identity provider needed to run the stack locally.

### Negative

- We own password storage and its breach risk. Accepted deliberately; a magic-link or OAuth
  migration remains possible because `AuthService` is the only component that touches credentials.
- One device lookup per device-authenticated request. Measured as negligible; revocation
  correctness outranks it in the decision hierarchy.
- Clients must implement rotation correctly. Concurrent refreshes from one client will trip reuse
  detection — clients MUST serialise refreshes. This is documented in `CLIENT_RESPONSES.md`.

## Rejected alternatives

**Long-lived access tokens (hours).** Simple, and directly violates prompt revocation.

**JWT refresh tokens.** Self-describing and stateless, but revocation still needs a server-side
denylist — the same state, minus the simplicity.

**Opaque access tokens (database hit per request).** Instant revocation, but every request becomes
a database read, including the realtime path. The 10-minute JWT plus a device-state check gets
substantially the same guarantee for a fraction of the cost.

**Magic links / OAuth.** Better for a lazy user and no password to leak, but adds an email or
provider dependency before anyone can run the API locally. Revisit post-MVP; the seam exists.
