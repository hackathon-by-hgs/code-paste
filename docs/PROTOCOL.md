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

## Transport independence

The same event format must work over:

```text
LanTransport
RelayTransport (future)
```

The application should not care how the event arrived.
