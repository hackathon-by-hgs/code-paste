# ADR-009: LAN Data Plane Wire Protocol

## Status

Accepted.

Affects: `desktop` (owner of the reference implementation), `mobile`, `shared`. No effect on
`backend` or `frontend` — neither touches the data plane.

Supersedes nothing. Formalises what `desktop/internal/transport` already does, and settles the one
question it left open.

## Context

Every other boundary in this system has a contract. The LAN data plane does not.

`docs/PROTOCOL.md` defines the clipboard event envelope and declares it transport-independent, and
`contracts/schema/clipboard-event.schema.json` makes it normative. But nothing says how an event
crosses the wire: how two agents authenticate, how frames are delimited, how they are encrypted, or
what a frame actually contains. That was left to each client.

Two clients then implemented two incompatible answers:

- **`desktop`** sends `contentTypeLen(1) || contentType || payloadBytes` inside AES-256-GCM frames.
  Lean and correct about one thing in particular: clipboard payloads are arbitrary bytes, and
  base64ing them into a JSON string inflates every transfer by a third.
- **`mobile`** sends the `ClipboardEvent` JSON envelope, base64 payload included.

Neither can talk to the other, and both are wrong in a way the other is right about.

Worse, the only way to write the second client was to read the first client's Go source.
`DEV_GUIDE.md` §9 forbids exactly that — *"do not depend on another domain's internal file paths; if
you need something from another domain, it belongs in a contract on `main`."* The absence of this
ADR is what forced the violation.

### Why desktop's framing is insufficient

`docs/PROTOCOL.md` §Validation requires a receiver to validate the version, event id, sender
identity, session membership, sequence, content type, declared size, actual size, hash and payload
limits.

Desktop's frame carries a content type and bytes. It therefore **cannot perform eight of those ten
checks** — there is no event id to deduplicate on, no sequence to order by, no hash to verify
against, and no session id to bind the event to an authorized share. Loop prevention
(§Loop prevention) and idempotency (§Idempotency) are both specified in terms of `eventId`, which
never reaches the wire.

### Why mobile's framing is not merely suboptimal — it is impossible

The contract caps `image/png` and `image/jpeg` at 10,485,760 bytes. The frame cap is 11,534,336
bytes (11 MiB), sized to be "the largest payload the contract permits, plus room for the envelope".

Base64 is not an envelope-sized overhead:

```
max image payload                        10,485,760 B
base64 of that                           13,981,016 B
JSON envelope + inline base64 + GCM tag  13,981,032 B
frame cap                                11,534,336 B
                                         ---------------
exceeds the cap by                        2,446,696 B
```

A maximum-size image **cannot be sent at all** under mobile's encoding. This is not a performance
trade-off to weigh; it is a payload the format cannot represent. Raising the frame cap to
accommodate base64 would mean permanently paying a 33% tax on every image transfer and allowing a
peer to make us allocate 14 MiB per frame, to carry 10 MiB of content.

## Decision

Keep the envelope. Move the payload out of it.

A frame carries a one-byte type, a length-prefixed JSON metadata block holding the
`ClipboardEvent` envelope **with `payload` omitted**, and then the raw payload bytes:

```text
frameBody := type(1) || metaLen(4, big-endian) || metaJSON || payloadBytes
```

| Field | Width | Meaning |
|---|---|---|
| `type` | 1 | `0x01` = clipboard event. Any other value MUST be rejected. |
| `metaLen` | 4, BE | Byte length of `metaJSON`. MUST be ≤ 65535. |
| `metaJSON` | `metaLen` | UTF-8 JSON: the `ClipboardEvent` envelope minus `payload`. |
| `payloadBytes` | rest | The decoded payload. UTF-8 for `text/plain`, image bytes for `image/*`. **Never base64.** |

`metaJSON` is governed by the existing `clipboard-event.schema.json` with `payload` removed, so
every field, pattern and limit already specified continues to apply unchanged, and the existing
event vectors remain the authority on them.

### The two bindings that make this safe

`metaJSON` describes bytes that travel outside it, so the link between the two must be checked
rather than assumed:

1. `size` **MUST** equal `payloadBytes.length`.
2. `hash` **MUST** equal `sha256(payloadBytes)`, lowercase hex, `sha256:`-prefixed.

A receiver that skips these has reintroduced the `size-mismatch` and `hash-mismatch` vectors as
live vulnerabilities. Both are computed over the *decoded* bytes, which is what the event schema
already says and what these frames now carry directly — the encoding and the hash finally agree.

### Transport, now normative

The handshake and frame layer are lifted from `desktop/internal/transport` unchanged, because they
are sound. They are specified here so a second implementation need never read the first's source.

**Handshake** — station-to-station, dialer speaks first:

```text
dialer   -> version(1) || dialerEph(32)   || dialerStatic(32)
listener -> version(1) || listenerEph(32) || listenerStatic(32) || sig(64)
dialer   -> sig(64)
```

- `version` is `0x01`. Any other value MUST abort the connection.
- Ephemeral keys are X25519; static keys are the device's Ed25519 identity from ADR-005.
- Both signatures are Ed25519 over the transcript:

  ```text
  transcript := "codepaste-handshake-v1" || dialerEph || dialerStatic || listenerEph || listenerStatic
  ```

  Signing the transcript rather than a nonce is what binds authentication to *this* session: a
  signature captured elsewhere covers different ephemeral keys and will not verify.

**Key schedule** — HKDF-SHA256 (RFC 5869) over the X25519 shared secret:

```text
salt     := SHA-256(transcript)
material := HKDF-Expand(HKDF-Extract(salt, shared), "codepaste-frame-keys-v1", 64)
dialerToListener := material[0:32]
listenerToDialer := material[32:64]
```

**Frames** — length-prefixed AES-256-GCM, per-direction keys and counters:

```text
frame := length(4, big-endian) || AES-256-GCM(key, nonce, frameBody, no AAD)
nonce := 0x00 00 00 00 || sequence(8, big-endian)
```

- `sequence` starts at 0 per direction per connection and increments per frame. Keys are freshly
  derived every connection, so a counter is never reused under a key.
- `length` covers ciphertext **and** the 16-byte tag.
- `length` MUST be range-checked **before allocating**: `16 ≤ length ≤ 11534336`.
- A frame that fails authentication MUST close the connection. It MUST NOT be skipped — once a
  frame is rejected the counter is out of step, and every later frame is attacker-chosen.

### Authorization is not part of this protocol

The handshake proves *who* holds a key. It says nothing about whether that identity may exchange
clipboard data; that is the signed roster's job (ADR-003), checked separately and re-checked at
delivery. An implementation that treats a completed handshake as authorization has made "reachable
on this network" sufficient, which `CLAUDE.md` forbids absolutely.

## Consequences

### Positive

- Images become sendable at the contract's declared limit, with no base64 tax on any transfer.
- All ten §Validation checks are possible on the receive path. Deduplication, ordering and loop
  prevention finally have the `eventId` and `sequence` they are specified in terms of.
- `clipboard-event.schema.json` and its 28 vectors keep their authority — this ADR changes where
  the payload sits, not what the envelope means.
- A third implementation can be written from `main` alone, which is the standard every other
  boundary already meets.
- `type` leaves room for future frame kinds without a protocol version bump.

### Negative

- **Both existing clients must change.** Desktop gains the metadata block it never had; mobile
  moves its payload out of the JSON. Neither change is large, but neither is free, and until both
  ship there is still no interop.
- Two parsers per frame — a fixed-width header and a JSON block — rather than one. The length
  prefix and the 65535 cap keep that bounded.
- `metaJSON` is JSON inside an otherwise binary format. The alternative was a bespoke binary
  encoding of ten fields, which would have abandoned the existing schema and vectors for a saving
  of a few hundred bytes per transfer.

## Rejected alternatives

**Keep desktop's framing as-is.** Cheapest — one client changes instead of two — but it makes the
§Validation requirements permanently unimplementable and leaves `clipboard-event.schema.json`
describing something that never crosses a wire. Deduplication and loop prevention would need a
second, undocumented mechanism invented per client.

**Keep mobile's JSON-with-base64 envelope.** Ruled out arithmetically above: it cannot carry a
maximum-size image. Raising the frame cap to 15 MiB to compensate would pay 33% on every image and
hand a peer a larger allocation primitive, to move strictly less content.

**Negotiate the encoding at handshake time.** Two code paths through the security-critical receive
path, for a format difference with a clear winner. Algorithm agility was already rejected in the
roster signature for the same reason.

**Put the envelope in a separate frame before the payload.** Splits one logical event across two
frames and invites a receiver to process metadata before the payload it describes has arrived, or
to mismatch them under concurrency. One event, one frame.
