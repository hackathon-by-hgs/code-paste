# System Design

## 1. Product

A cross-device clipboard synchronization service designed around one principle:

> Copy once. It appears where you need it.

A user may have a laptop, phone, desktop, and other registered devices. Clipboard changes should propagate within seconds.

The product also supports explicit temporary LAN sharing between authorized users.

## 2. Goals

### MVP goals

- Account creation/login.
- Device registration.
- Desktop background clipboard agent.
- Text clipboard sync.
- Image clipboard sync.
- LAN discovery.
- Secure LAN transport.
- Device-level enable/disable.
- Explicit sharing sessions.
- Conflict handling.
- Basic observability without recording clipboard contents.
- Automated tests.

### Non-goals for MVP

- Full file synchronization.
- Clipboard history as a cloud archive.
- Enterprise admin console.
- Global public clipboard rooms.
- Complex workflow automation.
- Microservice architecture.
- End-to-end remote synchronization before the LAN experience is reliable.

## 3. Critical architectural constraint

The web application cannot be the primary background clipboard monitor.

A browser tab cannot reliably watch the operating system clipboard indefinitely.

Therefore:

```text
                    +----------------------+
                    |      Web App         |
                    | Account / Devices    |
                    | Sharing / Settings   |
                    +----------+-----------+
                               |
                         HTTPS / WSS
                               |
                    +----------v-----------+
                    |     Control Plane     |
                    | Auth / Devices / ACL  |
                    +----------+-----------+
                               |
                +--------------+--------------+
                |                             |
          LAN discovery                 Future relay
                |                             |
       +--------v---------+             +------v------+
       | Desktop Agent A  |             | Remote Path |
       +--------+---------+             +-------------+
                |
          encrypted LAN
                |
       +--------+---------+
       | Desktop Agent B  |
       +------------------+
```

Mobile platforms should use OS-supported mechanisms rather than attempting to bypass background restrictions.

## 4. Repository structure

Physical layout is defined in `DEV_GUIDE.md` on `main`. Summary: each domain lives on its own
long-lived orphan branch containing a single top-level folder, and `main` holds only docs,
contracts and agent config.

```text
origin/main        docs/, contracts/, CLAUDE.md, .codex/skills/   (no product code)
origin/shared      shared/      protocol + domain types
origin/backend     backend/     control plane API
origin/frontend    frontend/    web application
origin/desktop     desktop/     background clipboard agent
origin/mobile      mobile/      mobile client
```

Branches never merge into each other. Compatibility is enforced by versioned contracts on `main`
(`contracts/schema`, `contracts/openapi`, `contracts/vectors`), pinned per branch via
`CONTRACTS_VERSION`. See `DEV_GUIDE.md` §5.

The exact language/framework per domain can change. Boundaries should not.

## 5. Components

### Web

Responsibilities:
- Authentication UI.
- Device list.
- Device revocation.
- Sharing-session creation.
- Sharing-session membership management.
- Sync preferences.
- Privacy controls.
- Health/status.

Must not:
- Own clipboard synchronization logic.
- Assume browser clipboard APIs equal OS clipboard monitoring.
- Expose raw clipboard data in analytics.

### Desktop agent

Responsibilities:
- OS clipboard monitoring.
- Clipboard normalization.
- Change detection.
- Local encryption/decryption.
- LAN discovery.
- Secure peer connection.
- Sending/receiving clipboard payloads.
- Writing received payloads to OS clipboard.
- Local queue/retry.
- Background lifecycle.

The agent should be tiny, resilient, and boring.

### Mobile

Responsibilities depend on OS capabilities.

Potential mechanisms:
- User-triggered copy/share action.
- Share extension.
- App-specific clipboard import.
- OS-supported background mechanisms where available.

Do not promise invisible background monitoring if the OS does not permit it.

### API/control plane

Responsibilities:
- Identity.
- Device registration.
- Public device metadata.
- Device authorization.
- Sharing sessions.
- Membership.
- Revocation.
- Protocol negotiation.
- Future signaling/relay authorization.

The control plane should not need to receive clipboard payloads for LAN-only synchronization.

## 6. Identity model

Entities:

```text
User
 ├── Device
 │    ├── DeviceKey
 │    └── Capabilities
 └── ShareSession
      └── ShareMember
```

### User

```text
User {
  id
  email/identity provider reference
  createdAt
}
```

### Device

```text
Device {
  id
  userId
  name
  platform
  appVersion
  publicKey
  capabilities
  lastSeenAt
  revokedAt
}
```

### ShareSession

```text
ShareSession {
  id
  ownerUserId
  expiresAt
  status
}
```

### ShareMember

```text
ShareMember {
  sessionId
  userId
  role
  joinedAt
  revokedAt
}
```

## 7. Authorization model

Never:

```text
if sameSubnet:
    sendClipboard()
```

Instead:

```text
if authenticated
and deviceIsRegistered
and deviceIsAuthorizedForSession
and peerIdentityIsCryptographicallyVerified:
    sendClipboard()
```

LAN discovery tells a device that a peer exists.

Authorization determines whether data may be exchanged.

## 8. LAN discovery

Use a platform-appropriate local discovery mechanism.

Candidates:
- mDNS/DNS-SD.
- UDP discovery with strict response validation.

Discovery records should expose minimal metadata:

```text
service: clipboard-sync
deviceId: opaque-id
protocolVersion: 1
port: 12345
publicKeyFingerprint: ...
```

Never include clipboard contents.

Discovery should be treated as untrusted input.

## 9. Secure transport

Recommended direction:

- TLS/Noise-style authenticated channel.
- Device public-key identity.
- Short-lived authorization credentials.
- Session binding.
- Replay protection.
- Message sequence numbers.
- Payload size limits.

A discovered device should prove possession of its private key.

Do not invent custom cryptography.

Prefer established libraries/protocols.

## 10. Clipboard message

Conceptual envelope:

```text
ClipboardMessage {
  protocolVersion
  messageId
  senderDeviceId
  timestamp
  sequence
  contentType
  size
  payloadHash
  payload
}
```

Possible content types:

```text
text/plain
image/png
image/jpeg
text/uri-list
application/octet-stream   // future, not MVP
```

For MVP, arbitrary binary payloads should be rejected unless explicitly supported.

## 11. Deduplication

Every clipboard event needs an identifier.

Example:

```text
eventId = UUID
contentHash = SHA-256(normalizedPayload)
```

Receiving devices keep a small recent-event cache.

If an event was already applied, ignore it.

This prevents:

```text
A -> B -> A -> B -> A ...
```

from becoming an infinite feedback loop.

## 12. Sequence handling

Per device/session, use monotonically increasing sequence numbers where practical.

Receiver behavior:

- expected sequence: process.
- duplicate/old sequence: ignore.
- gap: request/recover only if recovery is supported.
- invalid sequence: reject.

Do not build guaranteed-delivery infrastructure until product requirements justify it.

## 13. Clipboard loop prevention

When the agent writes a received clipboard item:

```text
received event
     |
     v
mark event as remote-origin
     |
     v
write to OS clipboard
     |
     v
OS emits clipboard changed
     |
     v
agent sees matching event/hash
     |
     v
DO NOT rebroadcast
```

This behavior must have automated tests.

## 14. Conflict model

If two devices copy at almost the same time:

MVP rule:
- last accepted event wins according to a deterministic ordering.

Recommended metadata:

```text
timestamp
senderDeviceId
sequence
eventId
```

Do not depend solely on wall-clock time.

Future versions can add richer conflict semantics if users actually need them.

## 15. Offline behavior

LAN-first MVP:
- If peer unavailable, do not indefinitely queue sensitive clipboard data.
- Keep only a very small bounded local queue if needed.
- Expire queued clipboard payloads quickly.
- Do not silently upload to the cloud.

Future remote mode may use encrypted relay/storage.

## 16. Remote future compatibility

The domain should abstract:

```text
ClipboardTransport
  ├── LanTransport
  └── RelayTransport
```

The clipboard event format should remain transport-independent.

This allows:

```text
LAN now
Remote later
```

without rewriting the entire product.

## 17. Authentication

Authentication is required for:
- account identity.
- device registration.
- device revocation.
- sharing authorization.
- future remote synchronization.

For local operation, an already-registered device can receive short-lived credentials/authorization material and communicate directly over LAN.

Avoid sending clipboard payloads through the API server in the LAN path.

## 18. Performance target

Initial target:

- Local clipboard propagation: usually < 2 seconds.
- Small text payload: near-instant.
- Typical image: a few seconds depending on size/network.

Do not optimize for theoretical maximum throughput before measuring.

## 19. Reliability

The desktop agent must:
- restart safely.
- recover from network changes.
- handle sleep/wake.
- handle clipboard API errors.
- handle malformed peer messages.
- avoid crashing on oversized payloads.
- avoid infinite retry loops.

## 20. Privacy

Default:
- No clipboard content logging.
- No clipboard content in error messages.
- No clipboard content in analytics.
- No indefinite server storage.
- Clear local cache expiration.
- User-visible sync controls.

## 21. Observability

Safe telemetry:
- connection duration.
- peer count.
- protocol version.
- error category.
- bytes transferred.
- sync latency.

Unsafe telemetry:
- clipboard text.
- screenshots.
- raw clipboard payload.
- secrets extracted from clipboard.

## 22. Scaling strategy

Do not begin with:

```text
API
Redis
Kafka
Postgres
NATS
Kubernetes
multiple workers
multiple microservices
```

Start with:

```text
Web
API
Database
Desktop Agent
LAN peer transport
```

Introduce additional infrastructure only when a measured bottleneck or product requirement exists.

## 23. Failure scenarios

Must test:
- peer disappears.
- Wi-Fi changes.
- device sleeps.
- device wakes.
- duplicate event.
- stale event.
- malicious discovery response.
- unauthorized device.
- expired sharing session.
- revoked device.
- oversized clipboard.
- unsupported content type.
- malformed payload.
- simultaneous copies.
- reconnect storm.
- API unavailable.
- LAN available while API unavailable.
- API available while LAN unavailable.

## 24. MVP sequence

### Phase 1
- Protocol.
- Domain types.
- Desktop clipboard watcher.
- Local loopback sync.
- Tests.

### Phase 2
- LAN discovery.
- Authenticated peer connection.
- Two-device sync.
- Security tests.

### Phase 3
- API account/device registration.
- Device management.
- Web UI.

### Phase 4
- Sharing sessions.
- Mobile integration.
- UX hardening.

### Phase 5
- Remote transport abstraction.
- Optional relay.

The order may change, but each phase should remain independently testable.
