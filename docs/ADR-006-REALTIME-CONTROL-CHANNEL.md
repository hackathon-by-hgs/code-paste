# ADR-006: Realtime Control Channel

## Status

Accepted.

Affects: `backend` (owner), `desktop`, `mobile`. Optional for `frontend`.

## Context

Peer rosters (ADR-003) expire on a TTL, so revocation is correct without any push mechanism — but
its worst case is one full TTL. A connected agent should learn about a revocation in milliseconds,
not minutes.

The danger is obvious and worth naming: a bidirectional socket between agents and the server is
one small step from becoming a clipboard relay. That would silently break ADR-001, put clipboard
content on our infrastructure, and turn the control plane into the data plane.

## Decision

An authenticated WebSocket at `/v1/realtime` that carries **authorization state changes only**.

### Hard boundary

There is **no message type in either direction that carries clipboard content**, and the
`realtime-envelope` contract enumerates every permitted type as a closed set. Adding one would
require a contract change, a new protocol version, and an ADR superseding this one. A test asserts
that the union of client→server and server→client message types contains nothing outside that
enumeration.

The channel's job is the inverse of a relay: it tells an agent *"your cached authorization is
stale"*, and the agent then re-fetches a roster and continues moving clipboard data
device-to-device.

### Connection lifecycle

1. Client connects with a **device-bound** access token (browser tokens are refused — a browser is
   not a clipboard peer).
2. Server authenticates, re-checks device revoked/enabled state, and negotiates versions.
3. On success: `connection.ready` with `heartbeatIntervalSeconds` and the current `rosterVersion`,
   so a client immediately knows whether its cache is behind.
4. Heartbeat: client `ping` → server `pong`. Missing two intervals closes the socket with
   `heartbeat_timeout`. Dead-peer detection is the server's job; TCP will not tell us.
5. Server pushes `authorization.changed`, `device.revoked`, `session.*` as they occur.
6. On revocation the server pushes `device.revoked` **and closes the socket**. It does not wait for
   the client to cooperate.

### Authorization is not re-implemented here

Every socket event is produced by the same `AuthorizationService` the HTTP layer uses. The gateway
translates transport events into application calls and formats results; it holds no business rules.
`websocket-handler → database` is prohibited, as is a second copy of the roster predicate. This is
the specific failure the prompt calls "WebSocket privilege escalation": two code paths to the same
data, one of which quietly forgot a check.

### Resource bounds

| Control | Value | Why |
|---|---|---|
| Max connections per device | 2 | Allows a reconnect to overlap a stale socket, nothing more |
| Max connections per user | 20 | Bounds a compromised account's footprint |
| Max message size | 8 KiB | Control messages are tiny; anything larger is abuse or a bug |
| Messages per connection | 60/min, token bucket | Bounds a chatty or hostile client |
| Malformed messages | 5, then disconnect | `SECURITY.md` malformed-message throttling |
| Handshake timeout | 10s | Stops half-open connections accumulating |
| Unauthenticated sockets | Closed immediately | No anonymous connection state is ever allocated |

Connections are counted and evicted on close, including abnormal close, so a reconnect storm cannot
leak slots.

### Delivery semantics

**At-most-once, and deliberately not more.** Events are hints to re-fetch, not state transfer. A
lost `authorization.changed` costs at most one TTL of staleness — precisely the guarantee that
holds when the socket is absent entirely. This is why no queue, broker or offline buffer is needed,
and why `SYSTEM_DESIGN.md` §22's prohibition on brokers is not a constraint we have to fight.

Events are idempotent and carry `rosterVersion`, so a duplicate is harmless and a client can always
tell whether it is behind.

## Consequences

### Positive

- Revocation reaches connected agents in milliseconds; TTL expiry remains the correctness floor.
- No broker, no queue, no new infrastructure.
- Bounded resources per connection, per device and per user.
- The relay risk is closed by contract and by test, not by intention.

### Negative

- Sticky sessions or a fanout mechanism will be needed when the API runs on more than one instance.
  Documented as a known limitation; single-instance is correct for MVP, and the TTL floor means a
  missed push is a latency issue, never a security one.
- Stateful connections make the API less trivially horizontally scalable. Accepted for the same
  reason.

## Rejected alternatives

**Server-Sent Events.** Unidirectional, so heartbeats and acks need a second channel.

**HTTP long-polling.** Works, but burns a connection per device anyway with worse latency and more
moving parts.

**Polling only (no realtime).** Perfectly correct — this is the fallback the design already
guarantees. Rejected as the *only* mechanism because revocation latency equal to a full TTL is a
poor user experience for an action the user expects to be immediate.

**Reusing the socket for clipboard relay "just for remote devices".** The tempting one. It breaks
ADR-001, moves clipboard content onto our servers, and makes the privacy promise false. Remote
relay, if it ever ships, goes behind a separate `RelayTransport` abstraction with its own contract,
its own authorization decision and its own ADR.
