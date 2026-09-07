# Cross-Device Clipboard — Consolidated Specification Contract

**Version:** 1.0 (consolidation of the `main` documentation set as of 2026-09-07)
**Status:** Draft — supersedes nothing. This file *restates* the existing docs in one place; where
it and a source document disagree, **the source document wins** until this file is ratified.

**Consolidates:** `CLAUDE.md`, `DEV_GUIDE.md`, `README.md`, `docs/SYSTEM_DESIGN.md`,
`docs/PRODUCT_PRINCIPLES.md`, `docs/RULES.md`, `docs/SECURITY.md`, `docs/PROTOCOL.md`,
`docs/API_CONTRACTS.md`, `docs/TEST_STRATEGY.md`, `docs/ADR-001-LAN-FIRST.md`,
`docs/ADR-002-NATIVE-BACKGROUND-AGENT.md`, `docs/AGENT_HANDOFF_TEMPLATE.md`.

Normative keywords: **MUST**, **MUST NOT**, **SHOULD**, **MAY**.

---

## Table of contents

1. [The product in one page](#1-the-product-in-one-page)
2. [Non-negotiable principles](#2-non-negotiable-principles)
3. [Decision hierarchy](#3-decision-hierarchy)
4. [Architecture](#4-architecture)
5. [Repository and branch contract](#5-repository-and-branch-contract)
6. [Domain model](#6-domain-model)
7. [Authorization contract](#7-authorization-contract)
8. [Clipboard protocol v1](#8-clipboard-protocol-v1)
9. [Control-plane API contract](#9-control-plane-api-contract)
10. [Security contract](#10-security-contract)
11. [Privacy, logging and observability](#11-privacy-logging-and-observability)
12. [Reliability and failure scenarios](#12-reliability-and-failure-scenarios)
13. [Product and UX contract](#13-product-and-ux-contract)
14. [Engineering rules](#14-engineering-rules)
15. [Test contract](#15-test-contract)
16. [Agent operating contract](#16-agent-operating-contract)
17. [Anti-patterns](#17-anti-patterns)
18. [Definition of done](#18-definition-of-done)
19. [Accepted decisions (ADR register)](#19-accepted-decisions-adr-register)
20. [Known gaps in this specification](#20-known-gaps-in-this-specification)

---

## 1. The product in one page

### 1.1 Promise

> Copy once. It appears where you need it.

A user copies text or an image on one device; it appears on their other registered devices within
seconds. They configure nothing beyond signing in and installing an agent.

The user should think *"I copied it on my laptop and it was already on my phone"* — never
*"I configured a local network clipboard synchronisation protocol."*

### 1.2 The critical inversion

Clipboard data **MUST NOT** flow through the server on the local path. It moves **device to
device** over the local network, encrypted, between native background agents (ADR-001).

The backend is therefore **not a sync service**. It is an identity and authorization registry — a
bouncer with a guest list. It answers exactly one question for each agent:

> Who am I allowed to exchange clipboard data with, and how do I cryptographically recognise them?

### 1.3 User journeys

```text
Setup                     Steady state              Sharing
─────                     ────────────              ───────
Install                   Copy                      Open Share
   │                        │                          │
Login                     Automatic sync            Create session
   │                        │                          │
Allow permissions         Paste                     Authorized user joins
   │                                                   │
Done                                                Copy → everyone in session receives
```

### 1.4 MVP scope

**In scope:** account creation/login · device registration · desktop background agent · text
sync · image sync · LAN discovery · secure LAN transport · per-device enable/disable · explicit
sharing sessions · conflict handling · safe observability · automated tests.

**Out of scope for MVP:** full file synchronisation · cloud clipboard history archive · enterprise
admin console · public clipboard rooms · workflow automation · microservices · end-to-end remote
sync before LAN is reliable.

---

## 2. Non-negotiable principles

1. **Simplicity beats feature count.** The target user is lazy. Every unnecessary click, setting,
   permission, prompt and configuration step is a product defect.
2. One-tap / one-time configuration wherever the platform permits it.
3. Local-first transport for local-network devices.
4. Remote transport **MUST** be possible later without redesigning the domain model.
5. Authentication exists for identity, device registration, authorization and future remote
   operation — **not** because LAN discovery is trusted.
6. **"Same Wi-Fi" is never sufficient authorization.**
7. Clipboard data is sensitive by default.
8. No silent clipboard redistribution to unknown users.
9. Explicit device/user/session membership is mandatory for sharing.
10. Code quality is a first-class feature.
11. Tests are mandatory before merge/push.
12. Every agent leaves a handoff after meaningful work.
13. Prefer boring, maintainable technology over clever infrastructure.
14. No dependency unless it materially reduces complexity.
15. Do not build a distributed system before the product needs one.

---

## 3. Decision hierarchy

When requirements conflict, resolve strictly in this order:

```text
1. Security / privacy
2. Correctness
3. Simplicity
4. Reliability
5. Maintainability
6. Performance
7. Feature breadth
```

A lower item **MUST NOT** be traded against a higher one without an ADR recording the exception.

---

## 4. Architecture

### 4.1 Topology

```text
                    +----------------------+
                    |      Web App         |   account · devices
                    |  (no sync logic)     |   sharing · settings
                    +----------+-----------+
                               |
                         HTTPS / WSS
                               |
                    +----------v-----------+
                    |    CONTROL PLANE     |   auth · devices · keys
                    |                      |   ACL · sessions · signaling(future)
                    +----------+-----------+
                               |
                +--------------+--------------+
                |                             |
          LAN discovery                 Future relay
                |                             |
       +--------v---------+             +-----v-------+
       | Desktop Agent A  |             | Remote path |
       +--------+---------+             +-------------+
                |
     encrypted authenticated LAN
                |
       +--------v---------+
       | Desktop Agent B  |
       +------------------+
```

### 4.2 Component responsibilities

| Component | Owns | MUST NOT |
|---|---|---|
| **Web app** | Auth UI, device list, revocation, sharing sessions and membership, sync preferences, privacy controls, health/status | Own clipboard sync logic; assume browser clipboard APIs equal OS clipboard monitoring; expose raw clipboard in analytics |
| **Desktop agent** | OS clipboard monitoring, normalisation, change detection, local encryption, LAN discovery, secure peer connection, send/receive, writing to OS clipboard, bounded local queue, background lifecycle | Fake background behaviour; trust a discovered peer; crash on malformed input |
| **Mobile client** | Platform-approved clipboard/share integration: user-triggered copy/share, share extension, app-specific import, OS-sanctioned background mechanisms | Promise invisible background monitoring the OS does not permit; attempt to bypass OS restrictions |
| **Control plane** | Identity, device registration, public device metadata, device authorization, sharing sessions, membership, revocation, protocol negotiation, future signaling/relay authorization | Receive clipboard payloads on the LAN path; store clipboard content; act as the sync transport |

### 4.3 Required interfaces

These **MUST** be interfaces with concrete implementations behind them, so transport can change
without redesign:

```text
Discovery · Transport · ClipboardProvider · Authentication · Authorization · Persistence · Relay

ClipboardTransport
  ├── LanTransport        (now)
  └── RelayTransport      (future)
```

The clipboard event format **MUST** remain transport-independent. The application layer **MUST
NOT** care how an event arrived.

### 4.4 Platform reality

- A browser **cannot** continuously monitor the OS clipboard in the background (ADR-002).
- iOS and Android do **not** allow unrestricted background clipboard monitoring.
- Where a platform cannot provide a capability silently, provide the simplest **supported**
  alternative. Never fake it with a hidden polling loop or a background tab.

### 4.5 Scaling posture

Start with: **Web · API · Database · Desktop agent · LAN peer transport.**

Do **not** begin with Redis, Kafka, NATS, Kubernetes, multiple workers, or microservices.
Additional infrastructure requires a *measured* bottleneck or a concrete product requirement.

---

## 5. Repository and branch contract

`DEV_GUIDE.md` is authoritative on physical layout. Summary of the binding rules:

### 5.1 Branch map

| Branch | Owns | Folder | May depend on |
|---|---|---|---|
| `main` | Docs, ADRs, protocol spec, contract fixtures, agent config | *(no product code)* | — |
| `shared` | Protocol/domain types, validation, test vectors | `shared/` | `main` contracts |
| `backend` | Auth, device registry, ACL, share sessions, signaling | `backend/` | `main` contracts, `shared` |
| `frontend` | Account/device/sharing web UI | `frontend/` | `main` contracts, `shared`, backend API |
| `desktop` | OS clipboard agent, LAN discovery, peer transport | `desktop/` | `main` contracts |
| `mobile` | iOS/Android clipboard + share integration | `mobile/` | `main` contracts |

Branches are **orphan roots with unrelated histories** and **MUST NOT** be merged into each other.

### 5.2 Domain branch root layout

```text
<branch root>
├── <domain>/            all product code — the only folder that grows
├── .github/workflows/   this domain's CI
├── CLAUDE.md            thin pointer to main's contract + domain rules
├── CONTRACTS_VERSION    pinned contract tag from main
├── HANDOFF.md           current state of this domain
├── .env.example         every required variable, no real values
└── README.md            how to run this domain in under 5 minutes
```

### 5.3 Contract pinning

```text
main/contracts/
├── VERSION                              e.g. protocol-v1.0.0
├── schema/   clipboard-event · device · share-session
├── openapi/  control-plane.yaml
└── vectors/  valid/  (MUST accept)   invalid/  (MUST reject)
```

Each domain pins a tag in `CONTRACTS_VERSION` and fetches it in CI:

```bash
git fetch origin --tags --depth=1
git archive "$(cat CONTRACTS_VERSION)" contracts | tar -x -C .contracts/
```

`.contracts/` is gitignored. Contracts **MUST NOT** be vendored or copy-pasted into a domain.

`vectors/invalid/` is the security surface: oversized payloads, bad hashes, replayed sequence
numbers, unknown content types, spoofed sender IDs. **Any domain that parses a clipboard event
MUST fail its build if it accepts one of these.**

### 5.4 Changing a contract

1. PR to `main` updating the spec, the schema **and** the vectors.
2. Tag `main` (`protocol-v1.1.0`).
3. Note it in `docs/HANDOFFS/`, listing every domain that must move.
4. Each domain bumps its own `CONTRACTS_VERSION` at its own pace.

Breaking changes get a **new protocol version**, never a silent redefinition of `v1`.

### 5.5 Hard prohibitions

Never merge domain branches · never put product code on `main` · never copy `contracts/` or
`shared/` source into a domain · never force-push a shared branch · never commit `.env`, tokens,
private keys or device keys · never create a long-lived branch absent from §5.1 · never depend on
another domain's internal file paths.

---

## 6. Domain model

```text
User
 ├── Device
 │    ├── DeviceKey
 │    └── Capabilities
 └── ShareSession
      └── ShareMember
```

```text
User {
  id                            opaque public identifier
  email / identity reference
  createdAt
}

Device {
  id                            opaque public identifier
  userId
  name
  platform
  appVersion
  publicKey                     public half only, always
  capabilities
  lastSeenAt
  revokedAt
}

ShareSession {
  id
  ownerUserId
  expiresAt                     short-lived by construction
  status
}

ShareMember {
  sessionId
  userId
  role
  joinedAt
  revokedAt
}
```

**Persistence rules.** Store user identity metadata, device metadata and authorization metadata.
Do **not** store clipboard text, clipboard images or clipboard history. If temporary buffering is
ever introduced it **MUST** be bounded, encrypted where appropriate, expired quickly, and its
retention behaviour documented.

---

## 7. Authorization contract

### 7.1 The predicate

Every authorization question in the system resolves against exactly this:

```text
authenticated
AND deviceIsRegistered
AND deviceNotRevoked
AND deviceIsAuthorizedForSession
AND peerIdentityIsCryptographicallyVerified
    ⇒ clipboard may flow
```

Forbidden, in any form:

```text
if sameSubnet:
    sendClipboard()
```

Network origin — IP, subnet, SSID — appears **nowhere** in the predicate.

### 7.2 Discovery is not authorization

LAN discovery tells a device that a peer *exists*. Authorization determines whether data may be
exchanged. A device that responds to discovery **MUST** be treated as hostile until authenticated.

### 7.3 Revocation

Revocation **MUST** take effect promptly. A revoked device **MUST** stop receiving data, and an
expired sharing session **MUST** stop granting access, without requiring a user action on the
peer device.

---

## 8. Clipboard protocol v1

### 8.1 Versioning

Current protocol: **`v1`**. Changes **SHOULD** be backward compatible where practical. Breaking
changes require a new protocol version.

### 8.2 Event envelope

```json
{
  "version": 1,
  "eventId": "uuid",
  "senderDeviceId": "device-id",
  "sessionId": "session-id",
  "sequence": 42,
  "createdAt": "2026-01-01T00:00:00Z",
  "contentType": "text/plain",
  "size": 12,
  "hash": "sha256...",
  "payload": "..."
}
```

Conceptual. Binary serialisation only if measurement proves JSON insufficient.

### 8.3 Content types

| Status | Types |
|---|---|
| MVP | `text/plain`, `image/png`, `image/jpeg` |
| Future | `text/html`, `text/uri-list`, file metadata/payload |
| Rejected in MVP | `application/octet-stream` and any unlisted type |

Arbitrary binary payloads **MUST** be rejected unless explicitly supported.
Do not promise arbitrary clipboard fidelity across operating systems.

### 8.4 Receiver validation

A receiver **MUST** validate: version · event ID · sender identity · session membership ·
sequence · content type · declared size · **actual** size · hash · payload limits.

It **MUST** reject: unknown protocol versions · oversized payloads · invalid content types ·
invalid encodings · malformed envelopes · missing required metadata · expired authorization ·
invalid signatures/MACs · duplicate messages.

### 8.5 Size limits

```text
text:              1 MiB
image:            10 MiB
unknown/binary:   rejected
```

Starting defaults. These **MUST** be configurable at the protocol boundary.

### 8.6 Deduplication

```text
eventId     = UUID
contentHash = SHA-256(normalizedPayload)
```

Receivers keep a **bounded** cache of recently processed IDs. An already-applied event is ignored.
This is what stops `A → B → A → B → …`.

### 8.7 Ordering and sequence handling

Per-sender monotonically increasing sequence numbers.

| Condition | Behaviour |
|---|---|
| Expected sequence | Process |
| Duplicate / old | Ignore |
| Gap | Recover only if recovery is supported |
| Invalid | Reject |

Wall-clock timestamps are **informational** and **MUST NOT** be the sole ordering mechanism.
Do not build guaranteed delivery until the product requires it.

### 8.8 Loop prevention

```text
received event → mark as remote-origin → write to OS clipboard
      → OS emits clipboard-changed → agent matches event/hash → DO NOT rebroadcast
```

The sender **MUST** identify locally generated events; the receiver **MUST** mark remote-origin
writes. **This behaviour MUST have automated tests.**

### 8.9 Conflict model

MVP rule: last accepted event wins under a **deterministic ordering** using
`timestamp · senderDeviceId · sequence · eventId`. **MUST NOT** depend on wall clock alone.

### 8.10 Offline behaviour

If a peer is unavailable: do **not** indefinitely queue sensitive clipboard data. Keep at most a
very small bounded local queue, expire queued payloads quickly, and **never** silently upload to
the cloud as a fallback.

---

## 9. Control-plane API contract

The API is the control plane. It **MUST NOT** receive LAN clipboard payloads on the normal path.

### 9.1 Endpoints

```text
Authentication
  POST   /auth/login
  POST   /auth/refresh
  POST   /auth/logout

Devices
  POST   /devices                          register
  GET    /devices
  GET    /devices/:id
  DELETE /devices/:id
  POST   /devices/:id/revoke

Sharing
  POST   /share-sessions
  GET    /share-sessions
  GET    /share-sessions/:id
  POST   /share-sessions/:id/join
  POST   /share-sessions/:id/leave
  POST   /share-sessions/:id/revoke-member
  POST   /share-sessions/:id/expire

Signaling (future — MUST NOT be implemented until LAN transport needs it)
  POST   /signaling/offer
  POST   /signaling/answer
  POST   /signaling/ice
```

The exact authentication mechanism is implementation-specific and recorded per-domain as an ADR.

### 9.2 Device registration payload

Registration **MUST** include: device name · platform · app version · protocol version ·
public key · capabilities.

### 9.3 API rules

- Validate **every** request.
- Return stable error codes.
- Never return private keys.
- Never return clipboard contents.
- Never expose internal database IDs where opaque public IDs are preferable.
- Enforce authorization **server-side**; UI restrictions are not security.

---

## 10. Security contract

### 10.1 Threat model — assume all of this is true

Other devices exist on the same Wi-Fi · a malicious user can discover services · a malicious
device can send malformed packets · network traffic can be observed · users may accidentally join
the wrong sharing session · a registered device can later become compromised · clipboard contents
may contain passwords, tokens, personal data or financial information.

### 10.2 Security objectives

1. Unauthorized devices cannot receive clipboard contents.
2. Attackers cannot impersonate registered devices.
3. Network observers cannot read clipboard payloads.
4. Revoked devices stop receiving data.
5. Malformed network traffic cannot crash the agent.
6. Clipboard contents do not leak through logs or telemetry.
7. Temporary sharing is actually temporary.

### 10.3 Trust boundaries

```text
Internet → Control Plane → (identity/authorization) → Registered Device
                                                         OS Clipboard ⇄ Agent
                                                              │
                                          encrypted authenticated LAN channel
                                                              │
                                                     Another Registered Peer
```

### 10.4 Device identity

Each installed agent gets a device identity and a key pair.

| Private key | Public key |
|---|---|
| Device-local | Registered with the control plane |
| **Never** sent to the server | Associated with the device identity |
| **Never** logged | Advertised as a fingerprint in discovery |
| Stored in platform secure storage where available | |

### 10.5 Pairing

Pairing **MUST** establish device identity, account ownership, protocol version, capabilities and
the authorization relationship. It **MUST** use short-lived pairing material.
Permanent shared secrets pasted into terminals are prohibited.

### 10.6 Transport

All clipboard payloads travel over an authenticated encrypted channel providing
**confidentiality · integrity · peer authentication · replay resistance**.

Direction: TLS or Noise-style authenticated channel · device public-key identity · short-lived
authorization credentials · session binding · sequence numbers · payload size limits. A discovered
device **MUST** prove possession of its private key.

**Never invent custom cryptography.** Use established libraries and primitives.

### 10.7 LAN discovery

Platform-appropriate mechanism (mDNS/DNS-SD, or UDP discovery with strict response validation).
Records expose **minimal** metadata:

```text
service: clipboard-sync
deviceId: opaque-id
protocolVersion: 1
port: 12345
publicKeyFingerprint: ...
```

Discovery records **MUST NOT** contain clipboard content, and **MUST** be treated as untrusted
input.

### 10.8 Abuse controls

Rate limits · connection limits · payload limits · session expiry · device revocation ·
malformed-message throttling.

### 10.9 Pre-release security checklist

- [ ] Unauthorized LAN peer rejected
- [ ] Impersonated device rejected
- [ ] Revoked device rejected
- [ ] Expired session rejected
- [ ] Replay rejected
- [ ] Oversized payload rejected
- [ ] Malformed message rejected
- [ ] Invalid signature rejected
- [ ] Clipboard data absent from logs
- [ ] Clipboard data absent from analytics
- [ ] Secrets absent from repository
- [ ] Dependency audit passes

---

## 11. Privacy, logging and observability

### 11.1 Privacy defaults

No clipboard content logging · no clipboard content in error messages · no clipboard content in
analytics · no indefinite server storage · clear local cache expiration · user-visible sync
controls.

### 11.2 Logging

| Allowed | Forbidden |
|---|---|
| `device connected` | `clipboard = "password123"` |
| `peer authentication failed` | `image = <raw bytes>` |
| `payload rejected: too_large` | `token = "..."` |
| `sync latency: 142ms` | any secret extracted from a clipboard |

### 11.3 Telemetry

| Safe | Unsafe |
|---|---|
| connection duration · peer count · protocol version · error category · bytes transferred · sync latency | clipboard text · screenshots · raw payloads · secrets from clipboard |

---

## 12. Reliability and failure scenarios

### 12.1 Agent reliability requirements

The desktop agent **MUST**: restart safely · recover from network changes · handle sleep/wake ·
handle clipboard API errors · handle malformed peer messages · not crash on oversized payloads ·
avoid infinite retry loops.

### 12.2 Failure scenarios that MUST be tested

peer disappears · Wi-Fi changes · device sleeps · device wakes · duplicate event · stale event ·
malicious discovery response · unauthorized device · expired sharing session · revoked device ·
oversized clipboard · unsupported content type · malformed payload · simultaneous copies ·
reconnect storm · API unavailable · **LAN available while API unavailable** · **API available
while LAN unavailable**.

### 12.3 Performance targets

Local clipboard propagation usually **< 2 seconds** · small text near-instant · typical image a
few seconds depending on size and network. Do not optimise for theoretical throughput before
measuring.

---

## 13. Product and UX contract

### 13.1 The lazy-user test

For every feature: *Can this be one tap?* If yes, make it one tap. If no: *can the app infer it
safely?* If yes, infer it. If no, make the decision clear and explain why.

One tap > three taps > a settings page.

### 13.2 UX prohibitions

Never make users understand ports · configure IP addresses · copy tokens manually · run terminal
commands · manage API keys · configure networking · read a tutorial to complete setup.
Avoid QR codes unless genuinely useful for pairing. Do not expose infrastructure concepts.

### 13.3 The UI MUST always answer

1. Is sync on?
2. Which devices can receive my clipboard?
3. Am I currently sharing?
4. How do I stop it?

Pairing **MUST** be visible and understandable. Destructive actions **MUST** require clear
confirmation. Sync pause **MUST** be easy to find.

### 13.4 Personal sync behaviour

A user's own devices sync by default · sync is opt-in during device setup · a device can pause
syncing instantly · the user can remove a device from the account · clipboard content is not
retained indefinitely.

### 13.5 Sharing behaviour

Sharing is an **explicit mode**. A user creates or joins a short-lived session. Only authenticated
users/devices belonging to that session receive clipboard data. "Same network" is a
discovery/transport optimisation, never an authorization boundary.

---

## 14. Engineering rules

### 14.1 Code quality

Small functions · strong typing · explicit error handling · meaningful names · no magic values ·
no dead code · no commented-out abandoned implementations · no duplicated business rules · no
unnecessary abstractions · no premature optimisation.

### 14.2 Architecture rules

Explicit boundaries · modules over microservices · data plane independent of control plane · LAN
transport requires no server-side clipboard storage · transport interfaces permit a future relay ·
domain types **MUST NOT** import UI or framework types · shared protocol types live in a versioned
shared package · the web app **MUST NOT** couple to desktop internals · no cross-package
reach-around imports (`http/` may call `devices/`; `devices/` **MUST NOT** call `http/`) · avoid
global mutable state.

### 14.3 Dependency rules

Before adding a package ask: is it truly needed · is there a standard-library solution · is it
maintained · does it increase attack surface · does it work on all target platforms · can the team
debug it. Prefer one reliable library over several overlapping ones.

### 14.4 Git rules

Commit scope is the domain; the message describes intent.

```text
feat(backend): register device public keys
fix(desktop): stop rebroadcast after remote clipboard write
test(shared): reject oversized image payloads
docs(main): define contract pinning for domain branches
```

Prohibited messages: `update`, `stuff`, `changes`, `fix`, `final`.
Feature branches are `<domain>/<kind>-<slug>` and PR **back into their own domain branch** — never
into another domain or `main`.

### 14.5 Pull request rules

Every PR answers, in the description:

1. What changed?
2. Why?
3. Which architecture boundary moved?
4. How was it tested? — **paste real output; never claim checks you did not run.**
5. What are the security/privacy implications?
6. What is left?

A PR is incomplete if meaningful behaviour lacks tests.

---

## 15. Test contract

### 15.1 Pyramid

```text
        E2E
       /   \
   Integration
      /     \
    Unit    Protocol
```

### 15.2 Required coverage

| Level | Must cover |
|---|---|
| **Unit** | clipboard normalisation · content hashing · event IDs · deduplication · sequence validation · loop prevention · authorization predicates · payload validation |
| **Integration** | device registration · authenticated peer connection · clipboard propagation · reconnect · session membership · device revocation |
| **Security** | unauthorized peer · fake device identity · replay · malformed envelope · oversized payload · expired authorization · revoked device · discovery spoofing |
| **E2E** | (a) A copies text → B receives → B's **OS clipboard** contains it. (b) A receives remote clipboard → A writes it → A does **not** rebroadcast |

High-value tests named as mandatory: auth · authorization · device revocation · protocol
validation · encryption/authentication · duplicate suppression · loop prevention · payload limits ·
session expiration · malformed network input · reconnect behaviour.

### 15.3 CI gates

```text
format · lint · typecheck · unit · contract-conformance · integration · build
```

(`contract-conformance` runs the vectors from the pinned `CONTRACTS_VERSION`.) Security-sensitive
repositories additionally run dependency/security scanning appropriate to the stack.

`main`'s CI validates docs and contracts: schemas parse, OpenAPI is valid, every vector matches its
schema, links resolve.

**Never push a branch with failing checks. "It's a small change" is not an exception.**

### 15.4 Test data rule

Never use real passwords, API keys, private clipboard content or personal data in tests. Synthetic
fixtures only.

---

## 16. Agent operating contract

### 16.1 Before work

1. Read `CLAUDE.md`. 2. Read `docs/SYSTEM_DESIGN.md`. 3. Read `docs/RULES.md`. 4. Read relevant
skill files. 5. Read existing handoff notes. 6. Identify dependencies on other agents.
7. Write a small implementation plan.

### 16.2 During work

Keep changes scoped · do not silently change contracts · update docs when behaviour changes · add
tests alongside implementation.

### 16.3 After work

1. Run relevant tests. 2. Run typecheck/lint/build. 3. Review security implications. 4. Update the
handoff. 5. Summarise changed files, tests, known issues, next steps.
**6. Do not claim success without actually running the checks.**

### 16.4 Multi-agent rule

Agents own bounded areas. Do **not** rewrite another agent's subsystem because your preferred
architecture differs. A cross-cutting change requires: a documented reason, an updated architecture
decision, and a notification in the handoff. Avoid simultaneous edits to the same files — the
branch-per-domain layout makes this structurally difficult by design.

### 16.5 Handoffs

- **Domain handoff** → `HANDOFF.md` at the domain branch root, updated in the same PR as the work.
- **Cross-cutting handoff** → `docs/HANDOFFS/` on `main`, using `docs/AGENT_HANDOFF_TEMPLATE.md`.
  **Required** whenever a change affects another domain: contract changes, new endpoints, protocol
  bumps, security-model changes.

Handoff sections: Agent · Date · Milestone · Objective · Completed · Files changed · Architecture
decisions · Tests run (command + real result) · Security review (authentication, authorization,
input validation, sensitive data handling, logging) · Known limitations · Next agent should know ·
Follow-up tasks · Integration notes.

---

## 17. Anti-patterns

Never:

- Broadcast clipboard contents to every IP on a LAN.
- Trust an IP address as identity.
- Trust Wi-Fi membership as authorization.
- Store raw clipboard data permanently by default.
- Log clipboard contents.
- Put secrets or tokens in clipboard logs or analytics.
- Add microservices for hypothetical scale.
- Add a message broker before there is demonstrated need.
- Make setup require a tutorial.
- Make agents depend on undocumented local state.
- Skip tests because a change is "small".
- Push failing code.
- Fake background behaviour with a browser tab or hidden polling loop.

---

## 18. Definition of done

A task is **not** done until all of the following hold:

- [ ] Implementation exists
- [ ] Relevant tests pass (with real output recorded)
- [ ] Failure behaviour is considered
- [ ] Security/privacy impact is considered
- [ ] Documentation and contracts are updated
- [ ] Handoff is updated
- [ ] Build/typecheck/lint pass

> No task is complete because the code compiles. Done means correct, tested, secure, documented,
> integrated and handed off.

---

## 19. Accepted decisions (ADR register)

| ADR | Title | Status | Core decision |
|---|---|---|---|
| **001** | LAN-First Clipboard Data Plane | Accepted | Clipboard data moves peer-to-peer over an authenticated encrypted local connection. The control plane handles identity, registration, authorization, sessions and future signaling only. Rejected alternative: *"broadcast clipboard to everyone on the LAN"* — unsafe, no identity, trivially snooped, no meaningful authorization. |
| **002** | Native Background Agent | Accepted | A native/background-capable agent is the primary seamless client; the web app manages account and configuration; mobile uses platform-approved capabilities. Rule: **never fake background behaviour** with a browser tab or hidden polling loop. |

**ADR-001 consequences accepted:** fast local sync, better privacy, lower backend bandwidth, works
during brief internet outages once authorization material is held — at the cost of native
networking, per-platform discovery differences, a later transport for NAT/remote, and demanding
peer-to-peer security work.

**ADR-002 consequences accepted:** real background behaviour and better OS integration — at the
cost of multiple platform implementations, OS permission constraints, and packaging work.

---

## 20. Known gaps in this specification

These are unresolved as of consolidation and **MUST** be closed before the domains can follow the
workflow this contract describes.

| # | Gap | Impact | Owner |
|---|---|---|---|
| 1 | **`contracts/` does not exist on `main`.** `DEV_GUIDE.md` §5 requires `VERSION`, `schema/`, `openapi/` and `vectors/`; none are present. | Every domain's `contract-conformance` CI gate has nothing to run. The security surface (`vectors/invalid/`) is undefined. | `main` |
| 2 | **No `protocol-v1.0.0` tag.** | `CONTRACTS_VERSION` has nothing to point at; the `git archive` pinning step cannot work. | `main` |
| 3 | **No domain branches.** `origin` has only `main`; the `DEV_GUIDE.md` §10 bootstrap has not been run. | No domain has anywhere to commit code. | Repo owner |
| 4 | **Peer authorization distribution is unspecified.** The docs require agents to verify peer identity against authorized keys, but no endpoint or mechanism delivers that roster, its freshness, or its revocation propagation. | Blocks `desktop`, `mobile` and `backend` simultaneously — it is the crux of §7. | `main` + `backend` |
| 5 | **Pairing flow is stated as a goal, not a protocol.** §10.5 lists required properties; the actual exchange (who shows what to whom) is undefined. | Blocks device registration UX across `frontend`, `desktop`, `mobile`. | `main` |
| 6 | **Authentication mechanism is "implementation-specific".** | Fine for the backend to decide, but token shape, lifetime and revocation semantics are cross-domain and belong in a contract. | `backend` → ADR |
| 7 | **Size limits are specified as defaults that "must be configurable at the protocol boundary"** — but no component is named as their source of truth. | Two agents could enforce different limits. | `main` |
| 8 | **No API versioning scheme.** `API_CONTRACTS.md` lists unversioned paths. | A breaking API change would have no migration path. | `main` |

---

*End of consolidated specification contract.*
