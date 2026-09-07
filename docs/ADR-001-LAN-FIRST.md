# ADR-001: LAN-First Clipboard Data Plane

## Status

Accepted

## Context

The primary product promise is extremely fast, simple clipboard synchronization between nearby devices.

Sending all clipboard contents through a cloud backend would:
- add latency,
- increase privacy exposure,
- increase infrastructure complexity,
- increase operating cost,
- make local use dependent on internet connectivity.

## Decision

Use a LAN-first data plane.

The control plane handles:
- identity,
- device registration,
- authorization,
- sharing sessions,
- future signaling.

Registered devices exchange clipboard data directly over an authenticated encrypted local connection when possible.

## Consequences

### Positive

- Fast local sync.
- Better privacy.
- Lower backend bandwidth.
- Works during temporary internet outages after devices have authorization material.
- Keeps remote relay as a future capability.

### Negative

- Native networking is required.
- Local discovery differs across platforms.
- NAT/remote scenarios need another transport later.
- Peer-to-peer security requires careful implementation.

## Rejected alternative

"Broadcast clipboard to everyone on the LAN."

Reason:
- unsafe,
- violates privacy,
- no user identity,
- trivial to snoop,
- impossible to provide meaningful authorization.
