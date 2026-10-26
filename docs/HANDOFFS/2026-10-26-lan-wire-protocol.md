# Agent Handoff

## Agent
`protocol / lan-data-plane`

## Date
`2026-10-26`

## Milestone
LAN data plane wire protocol promoted to a contract (ADR-009), with conformance vectors verified
against all three implementations, and `main` given the CI it was documented to already have.

## Objective

Close the one boundary in this system that had no contract.

The handshake, frame format and payload encoding existed only in `desktop/internal/transport`.
`mobile` had to be written by reading that Go source — a direct violation of `DEV_GUIDE.md` §9
("do not depend on another domain's internal file paths") — and the two clients still ended up
mutually unintelligible. Settle the format, write it down, and prove both existing clients agree
with what is written.

## Completed

- **`docs/ADR-009-LAN-WIRE-PROTOCOL.md`** — the handshake, key schedule and frame layer lifted from
  desktop's implementation into normative text, plus the decision that resolves the frame-body
  disagreement.
- **`docs/PROTOCOL.md`** — new normative §"LAN transport framing"; the event envelope section now
  states that `payload` travels outside the envelope on the LAN.
- **`contracts/vectors/wire/`** — `handshake-kdf.json`, `frame-seal.json`,
  `frame-body-invalid.json` and a README explaining what each guards.
- **`contracts/tools/`** — `verify-contracts.mjs`, `verify-wire-vectors.mjs`,
  `verify-doc-links.mjs`, with pinned dependencies.
- **`.github/workflows/main-ci.yml`** — `main` had **no CI at all**, despite `DEV_GUIDE.md` §6
  describing what it validates. Three jobs now exist: `contracts`, `no-product-code`, `no-secrets`.

## Files changed

- `docs/ADR-009-LAN-WIRE-PROTOCOL.md` (new)
- `docs/PROTOCOL.md`
- `docs/HANDOFFS/2026-10-26-lan-wire-protocol.md` (new, this file)
- `contracts/vectors/wire/{README.md,handshake-kdf.json,frame-seal.json,frame-body-invalid.json}` (new)
- `contracts/tools/{package.json,package-lock.json,.gitignore,verify-contracts.mjs,verify-wire-vectors.mjs,verify-doc-links.mjs}` (new)
- `.github/workflows/main-ci.yml` (new)

## Architecture decisions

| ADR | Decision | Affects |
|---|---|---|
| 009 | LAN wire protocol: transcript-signed handshake, AES-256-GCM frames, and a frame body of `type \|\| metaLen \|\| metaJSON \|\| rawPayload` | `desktop`, `mobile`, `shared` |

**The frame body is the load-bearing part.** Two clients disagreed and both were partly right:

- `desktop` sent `contentTypeLen \|\| contentType \|\| payloadBytes`. Lean, and correct that base64ing
  clipboard bytes into JSON inflates every transfer. But it carries no `eventId`, `sequence`, `hash`
  or `sessionId`, so **eight of the ten checks `docs/PROTOCOL.md` §Validation requires are
  impossible**, and both idempotency and loop prevention are specified in terms of an `eventId` that
  never reached the wire.
- `mobile` sent the `ClipboardEvent` JSON envelope with a base64 payload. That carries everything —
  and **cannot send a maximum-size image at all**:

  ```
  max image payload                        10,485,760 B
  base64 of that                           13,981,016 B
  JSON envelope + inline base64 + GCM tag  13,981,032 B
  frame cap                                11,534,336 B
  exceeds the cap by                        2,446,696 B
  ```

The decision keeps the envelope and moves the payload out of it: metadata as JSON, bytes raw,
with two mandatory bindings (`size` equals the payload length, `hash` equals `sha256(payload)`).
Both clients change; neither change is large.

## Tests run

```text
cd contracts/tools && npm ci && npm run verify
```

Result — **PASS**:

```text
schemas
  ok    5 schemas compile, with and without format support
  ok    every schema declares $schema and $id
clipboard-event vectors
  ok    6 valid vectors accepted by the schema
  ok    18 vectors rejected by the schema, as labelled
  ok    4 vectors pass the schema and need the semantic layer, as labelled
openapi
  ok    openapi 3.1.0
  ok    19 paths, 23 operations, 26 schemas
  ok    30 distinct $refs all resolve
handshake-kdf.json
  ok    transcript / shared secret / salt / hkdf material
  ok    dialerToListener / listenerToDialer
  ok    dialer + listener signatures verify over the transcript
frame-seal.json
  ok    text-plain-sequence-0: body encoding / size / hash / nonce / sealed frame
  ok    image-png-sequence-1: body encoding / size / hash / nonce / sealed frame
frame-body-invalid.json
  ok    7 malformed bodies rejected, each for the reason it documents
verify-doc-links
  ok    72 references across 33 markdown files
```

The OpenAPI and vector-label counts independently reproduce what the 2026-09-07 handoff reported
(`6 accepted / 22 rejected — 18 by schema, 4 semantic-only`, `19 paths | 23 operations |
26 schemas | 0 broken refs`), which is the first time anything has actually re-checked them.

### Cross-implementation verification

The vectors were generated with Node's stdlib — an implementation independent of both clients —
and then checked against each client's own code:

| Implementation | Checked | Result |
|---|---|---|
| Node (generator) | — | reference |
| **Dart** (`mobile`, `SecureChannel`) | transcript layout, X25519 exchange, HKDF material, both directional keys, Ed25519 transcript signature | **matches exactly** |
| **Go** (`desktop`, `internal/transport`) | its own `transcript()` and `deriveKeys()`, its compiled-in labels, salt, both directional keys, signature verification, `nonceFor()` layout | **matches exactly** |

Both checks used temporary harnesses, run and then removed; neither branch was modified.

**So the channel layer already interoperates.** The only incompatibility between the two shipped
clients is the frame body, which is exactly what this ADR settles.

## Security review

- **Authentication:** unchanged in substance — the transcript-signed station-to-station handshake is
  desktop's, now specified. Writing it down removes the need for a second implementer to infer it,
  which is how signature-bypass bugs enter.
- **Authorization:** explicitly **not** part of this protocol. ADR-009 states that a completed
  handshake proves identity only, and that authorization is the signed roster's decision (ADR-003),
  re-checked at delivery. An implementation treating a handshake as authorization has made
  "reachable on this network" sufficient.
- **Input validation:** the frame body's two bindings are the new security surface.
  `size-disagrees-with-payload` and `hash-disagrees-with-payload` are both well-formed JSON and
  **pass schema validation** — the metadata describes bytes that travel outside it, so only an
  explicit check catches tampering. They are the frame-level twins of the existing `size-mismatch`
  and `hash-mismatch` event vectors.
- **Sensitive data handling:** `handshake-kdf.json` contains fixed private keys. They are test
  material, derived from published labels, and must never appear in a device, build or deployment.
  The `no-secrets` CI job rejects committed PEM key material and a tracked `.env`.
- **Logging:** unchanged. No contract here permits clipboard content anywhere.

## Known limitations

1. **Nothing implements ADR-009 yet.** Both clients still speak their old frame bodies, so there is
   still no interop until both ship. The channel beneath is already compatible.
2. **A tag is required before any domain can adopt this.** `DEV_GUIDE.md` §5 is explicit: contract
   change → tag → each domain bumps `CONTRACTS_VERSION` at its own pace. Until `main` is tagged,
   the conformance tests cannot be wired into either client's CI, because their pinned contracts do
   not contain `vectors/wire/`.
3. **`contracts/tools/` puts Node tooling on `main`.** `main` previously had no build tooling at
   all. It is verification only, never shipped, and `no-product-code` enforces that no domain folder
   appears — but it is a new kind of thing on this branch.
4. **No vector covers a full handshake over a socket**, only the key schedule and framing. The
   byte-level exchange is covered by each client's own tests.
5. The doc reference checker only validates `docs/` and `contracts/` paths that name a file.
   Cross-branch references (`backend/...`, `desktop/...`) are skipped by design, since those files
   legitimately do not exist on `main`.

## Next agent should know

- **Read ADR-009 before touching either transport.** The transcript layout, the HKDF salt/info and
  the nonce byte order are the three things that produce a channel which works against itself and
  nothing else. The vectors exist because those failures are invisible in single-implementation
  testing.
- **Implement the two bindings.** A receiver that validates `metaJSON` against the event schema and
  stops there accepts tampered payloads. Check `size` against the actual length and `hash` against
  `sha256(payloadBytes)`.
- **`metaJSON` must not contain `payload`.** There is a vector for it.
- **Never skip a frame that fails authentication** — close the connection. Once a frame is rejected
  the counter is out of step and every later frame is attacker-chosen.
- **`main` now has CI.** Run `cd contracts/tools && npm ci && npm run verify` before proposing a
  contract change; it catches a mislabelled vector or a dangling OpenAPI `$ref` immediately.

## Follow-up tasks

- [ ] `main`: tag `protocol-v1.1.0` once this merges (additive — no existing field changed).
- [ ] `desktop`: bump `CONTRACTS_VERSION`, add the metadata block, keep the Go vector test
      permanently rather than as a harness.
- [ ] `mobile`: bump `CONTRACTS_VERSION`, move the payload out of `metaJSON`, keep the Dart vector
      test permanently.
- [ ] `main`: still open from 2026-09-07 — `docs/CLIENT_RESPONSES.md` §3 shows `publicKey` in
      60-character SPKI form, which the OpenAPI pattern `^[A-Za-z0-9+/]{43}=$` rejects. Reported by
      `desktop`, reported again by `mobile`, still wrong.
- [ ] `main`: `DEV_GUIDE.md` §3.4's feature-branch convention cannot work (git refuses
      `refs/heads/main/<slug>` while `refs/heads/main` exists). This work used
      `main--lan-wire-protocol`.
- [ ] `main`: the §2 branch map lists `shared`, which does not exist on the remote. Create it or
      drop the row.
- [ ] `frontend`, `desktop`, `mobile`: rename `.github/workflows/ci.yml` per domain. Confirmed live
      this session — a `mobile` PR's checks appear in the Actions UI under **"Frontend CI"**.

## Integration notes

**Contract version.** This is additive: no existing schema, field or pattern changed, and all 28
event vectors still pass unmodified. `protocol-v1.1.0` is the right tag; nothing needs a new
protocol version, and `version: 1` on the wire is unchanged.

**Adoption is per-domain and independent**, but interop requires both clients to move. Until they
do, a mobile↔desktop pairing authenticates and encrypts correctly and then fails to decode the
frame body — a clean failure, not a security one.

**No effect on `backend` or `frontend`.** Neither touches the data plane. The control plane still
never sees clipboard content, and ADR-009 adds no endpoint.

**Verifying locally:**

```bash
cd contracts/tools
npm ci
npm run verify
```
