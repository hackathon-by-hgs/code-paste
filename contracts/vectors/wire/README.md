# LAN wire vectors (protocol v1)

Conformance vectors for the LAN data plane defined in **ADR-009** and
`docs/PROTOCOL.md` §"LAN transport framing".

These exist because the data plane has two independent implementations in two
languages, and the failure they guard against is silent: a transcript built in a
different order, an HKDF salt and info swapped, or a nonce counter in the wrong
byte order all produce a channel that works perfectly against itself and not at
all against the other client.

| File | Asserts |
|---|---|
| `handshake-kdf.json` | Fixed key material through the handshake and key schedule. Reproducing `dialerToListener` and `listenerToDialer` proves the transcript layout, the X25519 exchange and the HKDF parameters all match. |
| `frame-seal.json` | Frame body encoding and AES-256-GCM sealing, for a text and an image event. Reproducing `frameHex` proves the encoder matches; decrypting `frameHex` back to `bodyHex` proves the decoder does. |
| `frame-body-invalid.json` | Frame bodies every implementation MUST reject. |

`handshake-kdf.json` contains **private keys**. They are fixed test material and
must never appear in a device, a build or a deployment.

## The two cases that matter most

`size-disagrees-with-payload` and `hash-disagrees-with-payload` are the security
surface. Both are well-formed JSON and both pass schema validation — the
metadata describes bytes that travel outside it, so only an explicit check
catches the disagreement. An implementation that validates `metaJSON` against
the event schema and stops there accepts a tampered payload.

They are the frame-level counterparts of `../invalid/size-mismatch.json` and
`../invalid/hash-mismatch.json`, and they fail the same way for the same reason.

## Deriving them again

The key material is `sha256("vector:dialer-static")` and the three matching
labels, so every value here is reproducible from the labels plus the algorithms
in ADR-009. They were generated with an implementation independent of both
clients, then checked against each client's own code.
