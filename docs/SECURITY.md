# Security Model

## Threat model

Assume:
- Other devices exist on the same Wi-Fi.
- A malicious user can discover services.
- A malicious device can send malformed packets.
- Network traffic can be observed.
- Users may accidentally join the wrong sharing session.
- A registered device can later become compromised.
- Clipboard contents may contain passwords, tokens, personal data, or financial information.

## Security objectives

1. Unauthorized devices cannot receive clipboard contents.
2. Attackers cannot impersonate registered devices.
3. Network observers cannot read clipboard payloads.
4. Revoked devices stop receiving data.
5. Malformed network traffic cannot crash the agent.
6. Clipboard contents do not leak through logs/telemetry.
7. Temporary sharing is actually temporary.

## Trust boundaries

```text
Internet
   |
   v
+---------+
| Control |
| Plane   |
+---------+
   |
   | identity/authorization
   v
+--------------------------+
| Registered Device        |
|                          |
| OS Clipboard <-> Agent   |
+--------------------------+
   |
 encrypted authenticated LAN channel
   |
+--------------------------+
| Another Registered Peer  |
+--------------------------+
```

## LAN trust rule

Discovery is not authorization.

A device that responds to discovery must be considered hostile until authenticated.

## Device identity

Each installed agent receives a device identity and key pair.

Private key:
- device-local.
- never sent to server.
- never logged.
- stored using platform secure storage where available.

Public key:
- registered with the control plane.
- associated with the device identity.

## Pairing

Pairing should establish:
- device identity.
- account ownership.
- protocol version.
- capabilities.
- authorization relationship.

Use short-lived pairing material.

Do not use permanent shared secrets pasted into terminals.

## Transport

All clipboard payloads must travel over an authenticated encrypted channel.

Minimum properties:
- confidentiality.
- integrity.
- peer authentication.
- replay resistance.

## Payload validation

Reject:
- unknown protocol versions unless explicitly supported.
- oversized payloads.
- invalid content types.
- invalid encodings.
- malformed envelopes.
- missing required metadata.
- expired authorization.
- invalid signatures/MACs.
- duplicate messages.

## Data minimization

Store:
- user identity metadata.
- device metadata.
- authorization metadata.

Avoid storing:
- clipboard text.
- clipboard images.
- clipboard history.

If temporary buffering is introduced:
- bound its size.
- encrypt where appropriate.
- expire quickly.
- document retention behavior.

## Logging

Allowed:

```text
device connected
peer authentication failed
payload rejected: too_large
sync latency: 142ms
```

Forbidden:

```text
clipboard = "password123"
image = <raw bytes>
token = "..."
```

## Abuse controls

Apply:
- rate limits.
- connection limits.
- payload limits.
- session expiry.
- device revocation.
- malformed-message throttling.

## Privacy UX

The UI should clearly communicate:
- which devices are connected.
- whether clipboard sync is enabled.
- whether a sharing session is active.
- who can receive shared clipboard data.
- how to stop sharing.

## Security testing checklist

Before release:
- [ ] Unauthorized LAN peer rejected.
- [ ] Impersonated device rejected.
- [ ] Revoked device rejected.
- [ ] Expired session rejected.
- [ ] Replay rejected.
- [ ] Oversized payload rejected.
- [ ] Malformed message rejected.
- [ ] Invalid signature rejected.
- [ ] Clipboard data absent from logs.
- [ ] Clipboard data absent from analytics.
- [ ] Secrets absent from repository.
- [ ] Dependency audit passes.
