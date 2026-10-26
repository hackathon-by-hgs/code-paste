# Clipboard Protocol

## Versioning

Current protocol: `v1`

Protocol changes must be backward-compatible when practical.

Breaking changes require a new protocol version.

## Event envelope

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

This is conceptual. Use a binary serialization only if measurement proves JSON is insufficient.

On the LAN data plane the envelope travels with `payload` **removed** and the payload bytes carried
raw alongside it — see "LAN transport framing" below and ADR-009. `size` and `hash` still describe
the decoded payload, so their meaning is unchanged.

## Content types

MVP:
- `text/plain`
- `image/png`
- `image/jpeg`

Future:
- `text/html`
- `text/uri-list`
- file metadata/payload.

## Validation

A receiver must validate:
- version.
- event ID.
- sender identity.
- session membership.
- sequence.
- content type.
- declared size.
- actual size.
- hash.
- payload limits.

## Idempotency

`eventId` is globally unique enough for the lifetime of the event.

The receiver maintains a bounded cache of recently processed IDs.

## Loop prevention

The sender must identify locally generated events.

The receiver must mark remote-origin writes.

A clipboard change caused by receiving an event must not automatically create a new outgoing event.

## Ordering

Use sequence numbers per sender.

Wall-clock timestamps are informational and must not be the sole ordering mechanism.

## Size limits

Set explicit limits per content type.

Example starting values:

```text
text: 1 MiB
image: 10 MiB
unknown/binary: rejected
```

These are starting defaults and must be configurable at the protocol boundary.

## LAN transport framing

Normative. Specified in full by **ADR-009**; summarised here.

Two agents on a LAN establish a mutually authenticated, encrypted channel and then exchange one
event per frame.

### Handshake

Station-to-station. The dialer speaks first:

```text
dialer   -> version(1) || dialerEph(32)   || dialerStatic(32)
listener -> version(1) || listenerEph(32) || listenerStatic(32) || sig(64)
dialer   -> sig(64)
```

Ephemeral keys are X25519; static keys are the device's Ed25519 identity (ADR-005). Both signatures
cover:

```text
transcript := "codepaste-handshake-v1" || dialerEph || dialerStatic || listenerEph || listenerStatic
```

Key schedule, HKDF-SHA256 over the X25519 shared secret:

```text
salt     := SHA-256(transcript)
material := HKDF-Expand(HKDF-Extract(salt, shared), "codepaste-frame-keys-v1", 64)
dialerToListener := material[0:32]
listenerToDialer := material[32:64]
```

A completed handshake proves identity only. **Authorization is a separate decision** made against
the signed roster (ADR-003) and re-checked at delivery. Being reachable on a network is never
sufficient.

### Frames

```text
frame := length(4, big-endian) || AES-256-GCM(key, nonce, frameBody, no AAD)
nonce := 0x00000000 || sequence(8, big-endian)
```

`sequence` starts at 0 per direction per connection. `length` covers ciphertext and the 16-byte
tag, and MUST be checked against `16 <= length <= 11534336` **before allocating**. A frame that
fails authentication MUST close the connection rather than be skipped.

### Frame body

```text
frameBody := type(1) || metaLen(4, big-endian) || metaJSON || payloadBytes
```

| Field | Width | Meaning |
|---|---|---|
| `type` | 1 | `0x01` = clipboard event. Reject anything else. |
| `metaLen` | 4, BE | Length of `metaJSON`; MUST be <= 65535. |
| `metaJSON` | `metaLen` | The event envelope above, UTF-8 JSON, **without `payload`**. |
| `payloadBytes` | rest | Decoded payload. UTF-8 for `text/plain`, image bytes for `image/*`. Never base64. |

A receiver MUST check both bindings between the metadata and the bytes it describes:

- `size` equals `payloadBytes.length`
- `hash` equals `sha256(payloadBytes)`

Skipping either reintroduces the `size-mismatch` and `hash-mismatch` vectors as live
vulnerabilities.

## Transport independence

The same event format must work over:

```text
LanTransport
RelayTransport (future)
```

The application should not care how the event arrived. The framing above is specific to
`LanTransport`; a future relay carries the same envelope and the same `size`/`hash` meaning, and
may choose its own framing.
