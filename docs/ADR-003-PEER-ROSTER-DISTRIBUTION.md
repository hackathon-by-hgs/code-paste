# ADR-003: Signed Peer Roster Distribution

## Status

Accepted. Closes `SPEC_CONTRACT.md` gap #4 (and, via the `limits` field, gap #7).

Affects: `backend` (owner), `desktop`, `mobile`, `shared`. Requires no change to `frontend`.

## Context

`SYSTEM_DESIGN.md` §7 requires that clipboard flows only when
`peerIdentityIsCryptographicallyVerified`, and `SECURITY.md` requires that revocation take effect
promptly. But no document said **how a device learns which peer public keys are currently
authorized**.

This is the load-bearing gap in the whole product. Without it:

- an agent that discovers a peer via mDNS has no way to decide whether to trust it, and the
  temptation is to fall back on "same network" — the one thing the spec forbids absolutely;
- revocation has no propagation path, so a revoked device keeps syncing until someone restarts
  something.

Constraints that shape the answer:

1. The control plane **must not** become the clipboard transport (ADR-001).
2. LAN sync **must** survive a brief control-plane outage (`SYSTEM_DESIGN.md` §23: "LAN available
   while API unavailable").
3. We **must not** add a message broker or push infrastructure (`SYSTEM_DESIGN.md` §22).
4. Revocation must be prompt.

Requirements 2 and 4 pull against each other: offline tolerance means cached authorization, and
cached authorization is stale authorization.

## Decision

The control plane issues a **short-lived, signed peer roster**, per device, over plain HTTPS:

```
GET /v1/authz/peer-set      ->  SignedPeerRoster
GET /v1/authz/roster-keys   ->  the public keys that verify one (unauthenticated)
```

The roster names every device this device may exchange clipboard data with, each with the public
key needed to authenticate it on the LAN, plus the authoritative payload size limits.

Four properties do the work:

**1. Authorization expires rather than being revoked.** Each roster carries `expiresAt` (default
300s). After that instant it authorizes nothing. Revocation therefore needs no delivered message
and no broker — the attacker's best case is one roster TTL of residual access, and the window is a
configuration value rather than a function of whether a push succeeded.

**2. Signed bytes, not a signed object.** The response is `{ payload, signature }` where `payload`
is base64 of the exact JSON bytes. Verifiers check the signature over those bytes and only then
parse. Signing a JSON *object* would require canonicalisation (RFC 8785), and every implementation
that canonicalises slightly differently becomes a signature-bypass bug — across Rust, Swift and
Kotlin that is a near-certainty. This removes the failure class entirely.

**3. Bound to one requesting device.** `self.deviceId` is inside the signed payload, so a roster
issued to device A is worthless to device B; it cannot be replayed sideways.

**4. Monotonic `rosterVersion`.** Increments on every authorization-relevant change. A verifier
that has seen version N MUST reject a roster with version < N, which stops an attacker replaying an
older, more permissive roster that has not yet expired.

The realtime channel (ADR-006) pushes `authorization.changed` so a connected agent refreshes
immediately, but it is strictly an **optimisation**. Correctness rests on expiry alone. If the
socket never connects, the system is still correct — just up to one TTL slower.

### Excluded from a roster

The device itself; revoked devices; sync-paused devices (`syncEnabled = false`); devices whose
protocol version is incompatible; and members of expired or revoked sessions. Exclusion is computed
in one place (`AuthorizationService`), never re-derived per call site.

## Consequences

### Positive

- Revocation propagates with a bounded, tunable worst case and no push infrastructure.
- LAN sync keeps working through a control-plane outage, up to the TTL.
- Discovery, authorization and cryptographic verification stay three separate concepts.
- The control plane never sees a clipboard payload.
- Size limits get a single source of truth, closing gap #7.

### Negative

- Up to one TTL of residual access after revocation. Mitigated by the realtime push and by a short
  default TTL. A shorter TTL trades backend load for a tighter window; it is one config value.
- Devices must poll (or hold a socket). At a 300s TTL this is ~288 requests/device/day — trivial.
- The signing key is now security-critical infrastructure and needs rotation, which `keyId`
  supports.
- Agents must implement Ed25519 verification and rollback detection. This is unavoidable: it is
  the property that makes LAN peer identity meaningful.

## Rejected alternatives

**Push-only revocation (broker/WebSocket as the source of truth).** A revoked device simply
disconnects and never receives the revocation. Authorization would then depend on successfully
delivering a message to a hostile party. Also needs a broker, which `SYSTEM_DESIGN.md` §22 forbids
this early.

**Backend authorizes each transfer in real time.** Puts the control plane on the data path,
breaking ADR-001, adding latency, and failing entirely when the internet is down — the exact case
LAN-first exists to serve.

**Long-lived per-peer certificates.** Revocation then needs a CRL or OCSP, which is a strictly
larger version of the problem plus a new distribution mechanism.

**Unsigned roster over TLS.** TLS protects it in transit, but a cached roster on disk becomes
trivially forgeable, and offline tolerance means the cache is exactly what gets used when it
matters most.
