# Handoff — mobile

## Agent

`security / mobile data plane`

## Date

2026-10-26

## Milestone

Replaced the mobile client's placeholder cryptography with real, fail-closed
authorization: genuine Ed25519 roster verification, an authenticated encrypted
LAN channel, and a clipboard-event semantic validation layer proven against the
pinned contract vectors.

## Objective

Close the gap between what the previous handoff claimed and what the code did.
Roster signatures were not being verified, LAN traffic was not encrypted, and
the inbound listener accepted clipboard data from anyone who could reach its
port. All three are now closed.

---

## What was wrong

These were live code paths, not TODOs in unused files.

1. **Roster signatures were never verified.** `Ed25519Verifier._performVerification`
   checked that the key was 32 bytes, that the message was non-empty and that the
   signature "had entropy", then returned `true`. It was wired into
   `peer_discovery_service.dart`, the ADR-003 trust decision. With `_strictMode`
   defaulting to `false`, an unknown `keyId` also returned `true`, and so did the
   exception handler. **Anyone on the LAN could forge a roster and be accepted** —
   authorization had collapsed into "is on the same network".
2. **No control-plane keys were ever loaded.** `ControlPlaneService` called
   `/authz/keys` (the contract says `/authz/roster-keys`) and required
   `algorithm == 'Ed25519'` (the contract pins lowercase `ed25519`), so every key
   would have been skipped anyway — and `fetchAndRegisterKeys()` was never called
   from anywhere. The result was zero keys plus non-strict mode: accept everything.
3. **The roster was parsed before it was verified**, which ADR-003 forbids
   explicitly.
4. **Two of the five ordered roster checks were missing**: no `self.deviceId`
   match, and no `rosterVersion` rollback detection.
5. **A roster failure did not stop sync.** `home_provider` caught the error,
   logged "continuing anyway", and started clipboard sync regardless.
6. **The inbound LAN listener authenticated nothing.** Its "handshake" was a
   plain JSON message carrying a `deviceId`, which it believed. Any clipboard
   event claiming that id was then written to the user's clipboard. The roster
   was never consulted on the receive path at all.
7. **LAN payloads were not encrypted.** `RSAEncryptionService` was XOR against a
   key derived from the IV that shipped alongside the ciphertext.
   `TransportEncryption` returned plaintext, and its "signature" was an unkeyed
   SHA-256 compared against itself.
8. **Image hashes and sizes were wrong.** The hash was computed over the base64
   *text* rather than the decoded bytes, and the decoded size was approximated as
   `payload.length * 3 / 4`. The `image-png-1x1` vector declares 70 bytes; the
   approximation yields 72, so a valid event was rejected and every image hash
   disagreed with every other implementation.
9. **Unknown content types were silently coerced to `text/plain`** by
   `ClipboardEvent.fromJson`'s `?? ContentType.textPlain`, so the
   `unsupported-content-type` and `content-type-html-not-mvp` vectors would have
   been accepted as text.

---

## Completed

### Roster verification (ADR-003)

- `utils/roster_signature_verifier.dart` — real Ed25519 verification via the
  `cryptography` package, which was already a dependency. **There is no strict
  mode and no degraded path**: an unknown `keyId`, a malformed key, a bad
  signature and a thrown exception are all rejections. Key ids, public keys and
  signatures are matched against the contract's patterns before decoding, because
  Dart's base64 decoder accepts the URL-safe alphabet too.
- `services/roster_verifier.dart` — the five checks, in the order ADR-003
  mandates: signature over the raw bytes → parse → `self.deviceId` →
  `rosterVersion` monotonicity → `expiresAt`. Rejections are a named
  `RosterRejection` enum so tests assert the precise reason.
- `services/roster_version_store.dart` — persists the per-device `rosterVersion`
  high-water mark in secure storage, so a rollback is still detected after a
  restart. A rejected roster does not advance the mark.
- `services/control_plane_service.dart` — correct endpoint, correct lowercase
  algorithm, unauthenticated (the endpoint is public, so the device token is not
  sent), and it **throws if zero keys were registered** rather than leaving the
  app unable to verify anything.
- `providers/home_provider.dart` — loads the signing keys and the roster before
  sync, and **refuses to start sync if either fails**. No "continuing anyway".

### LAN data plane

- `services/secure_channel.dart` — a station-to-station handshake
  (Ed25519 authentication over a transcript binding both ephemeral X25519 keys)
  followed by length-prefixed AES-256-GCM frames with per-direction keys and
  counters. **Wire-compatible with the desktop agent's `internal/transport`**:
  same `codepaste-handshake-v1` / `codepaste-frame-keys-v1` labels, same
  hand-rolled HKDF-SHA256 key schedule, same 4-zero-bytes-plus-big-endian-counter
  nonce, same 11 MiB frame cap checked before allocation.
- `services/peer_authorizer.dart` — the single place that answers "may this
  proven identity exchange clipboard data now?", by fingerprint lookup through
  the verified roster. Because it reads through the roster cache, **an expired
  roster authorizes nobody**.
- `services/lan_server_service.dart` — rewritten. Nothing is read off a
  connection until the peer has completed the handshake *and* been found in the
  current roster. Authorization is re-checked per frame, so a revocation drops a
  live connection rather than only the next one. The envelope's `senderDeviceId`
  must match the peer that actually authenticated.
- `services/lan_transport_service.dart` — rewritten. Refuses to dial an
  unauthorized peer, and after the handshake confirms the answering device is the
  one the roster named, not merely *some* authorized device. Re-checks before
  every send.
- Deleted `rsa_encryption_service.dart`, `crypto_verification.dart` and
  `crypto_utils.dart` (whose fingerprint helper hashed the PEM text and omitted
  the `sha256:` prefix).

### Clipboard event contract conformance

- `models/clipboard_event.dart` — a strict decoder. Unknown fields, malformed
  ids, malformed timestamps and unsupported content types are rejected rather
  than coerced. The semantic layer JSON Schema cannot express is present: exact
  decoded size, hash over the **decoded** bytes, strict standard base64, and
  per-content-type limits.
- `PayloadLimits.fromRoster` — the control plane's published `limits` are
  honoured instead of a hardcoded 10 MB ceiling.
- `utils/device_key.dart` — correct `sha256:<hex>` fingerprints over the raw 32
  key bytes, and reconstruction of the signing key pair from secure storage.

---

## Tests run

Locally, on Flutter **3.38.9** — the exact version `FLUTTER_VERSION` pins — via
`fvm`. Every gate below was run and its exit code checked:

```
dart format --output=none --set-exit-if-changed lib test
  Formatted 53 files (0 changed)                      exit=0

flutter analyze --no-pub
  No issues found!                                    exit=0

flutter test --no-pub --coverage
  All tests passed!  (35 tests)                       exit=0
  coverage/lcov.info written
```

New suites:

| Suite | Covers |
|---|---|
| `test/roster_verifier_test.dart` (15) | Every roster rejection path, including **no key registered** and **unknown key id** — the two cases the old verifier answered "valid" to. Also rollback, wrong device, expiry, algorithm downgrade, tampered payload, and an explicit verify-before-parse ordering proof. |
| `test/secure_channel_test.dart` (7) | Handshake round trip, both-direction framing, forged-identity rejection, version rejection, tampered-frame authentication failure, oversized length prefix, clean close. |
| `test/lan_authorization_test.dart` (5) | Over real loopback sockets: an authorized peer is delivered; a peer that *proves* an identity the roster does not list is dropped; a mismatched envelope sender is dropped; nothing is delivered once the roster expires; a failed handshake never reaches authorization. |
| `test/contract_vectors_test.dart` (4) | All **6 valid** vectors accepted and all **22 invalid** rejected at the pinned `protocol-v1.0.0`, with an explicit assertion that the **4 semantic-only** vectors — the ones JSON Schema alone accepts — are rejected. Also that roster limits override the default ceiling. |

`CONTRACTS_VERSION` now pins `protocol-v1.0.0` instead of the raw commit
`0f80595`. The previous pin's stated reason — "protocol-v1.0.0 is not published
as a remote tag" — was incorrect; the tag exists and is on `main`. The contract
*content* at both refs is byte-identical, so this is a correction, not a bump.

CI was updated so the `checks` job fetches the pinned contracts before
`flutter test` (the vector suite runs there), and `contract-conformance` now
actually runs that suite instead of printing a notice that it is unimplemented.

### Not verified

- `flutter build apk` was not run; no Android/iOS compile or device test.
- **No mobile↔desktop interop test.** The channel is wire-compatible by
  construction and by reading desktop's source, but the two have never been run
  against each other.

---

## Security review

- **Fail-closed everywhere.** There is no configuration, flag or environment in
  which an unverified roster or an unauthenticated peer is accepted. The previous
  design had a `setStrictVerification(false)` default; that switch no longer
  exists, so it cannot be left off.
- **Three independent gates, none sufficient alone.** Discovery claims a device
  exists; the signed roster says an identity is authorized; the handshake proves
  the peer holds the private key. The receive path requires all three before a
  single frame is decoded.
- **Revocation needs no delivered message.** Authorization is read through the
  roster cache and re-checked per frame and per send, so an expiring roster
  withdraws authorization on its own, including mid-connection.
- **Verify before parse.** A JSON decoder never runs on unauthenticated bytes,
  and a test asserts the ordering by feeding a badly-signed non-JSON payload and
  requiring `badSignature` rather than a parse error.
- **Forward secrecy.** Frame keys come from a fresh ephemeral X25519 exchange per
  connection, so recovering a device's long-term key later does not decrypt
  captured traffic. Signatures cover both ephemeral keys, so one cannot be
  replayed into another session.
- **No clipboard content in logs.** Rejections log a reason code and an exception
  *type*, never payload bytes. `SecureLogging` remains the only logging path.
- **Hostile input bounds.** The frame length prefix is range-checked before
  allocation, and a frame that fails authentication kills the connection rather
  than resyncing a now-misaligned counter.

---

## Known limitations

1. **Outbound dialling has no peer addresses.** `PeerEndpoint` requires an
   address, and mobile has no mDNS implementation, so `ClipboardSyncService`
   starts the transport with an empty endpoint list. **Inbound sync works**: an
   authorized peer that dials this device is authenticated, authorized and
   delivered. Outbound is blocked on LAN discovery, not on security. Nothing was
   lost here — the previous `_resolvePeerAddress` returned `null` unconditionally,
   so outbound never worked.
2. **The payload encoding inside a frame is an open contract question.** This
   client carries the `ClipboardEvent` JSON envelope. The desktop agent carries
   raw content as `contentTypeLen(1) || contentType || payload`. **The two are
   therefore not yet interoperable above the channel**, even though the channel
   itself matches. The LAN handshake and frame format are not in `contracts/` at
   all — they exist only in desktop's Go source. See "For `main`" below; this
   needs a contract decision, not a unilateral guess from either client.
3. **`SCOPE_AUDIT.md` is stale** and contradicts this file (it reports 0–20%
   completion on work that exists). It predates several sessions; treat this file
   as authoritative and delete it.
4. **The branch root still violates `DEV_GUIDE.md` §9.** It carries committed
   copies of `contracts/`, `docs/`, `.codex/` and `DEV_GUIDE.md`. Copies are
   forbidden — the pin plus `.contracts/` is the supported mechanism, and the
   test suite now reads from `.contracts/`. The copies are currently identical to
   the tag, so this is a drift hazard rather than active drift.
5. **`.github/workflows/ci.yml` shares its path with `frontend` and `desktop`.**
   GitHub keys a workflow by file path, so all three collapse into one workflow
   record. `backend` solved this by renaming to `backend-ci.yml`; this branch
   should become `mobile-ci.yml`.
6. **Images are declared but untested end to end.** The semantic layer handles
   `image/png` and `image/jpeg` correctly against the vectors, but no image has
   moved between two real devices.
7. **No realtime socket (ADR-006).** Revocation still lands within the roster
   TTL; the socket only makes it faster.

---

## Next agent should know

- **Never reintroduce a "development mode" that accepts an unverifiable
  signature.** That single default is what made every other control in this
  client decorative. If a key cannot be fetched, the correct behaviour is to stop
  syncing and say so.
- **Authorization changes belong in `PeerAuthorizer` only.** Both the inbound and
  outbound paths call it; adding a check to one and not the other is exactly the
  failure this structure exists to prevent.
- **`ClipboardEvent.decode` is the only way in.** Do not construct an event from
  peer bytes by hand — the four semantic checks are not in the schema, and the
  vectors are the regression test for them.
- **Run the vector suite after any change to the event model.** It needs the
  pinned contracts fetched first:
  ```bash
  contract_ref="$(cat CONTRACTS_VERSION)"
  git fetch origin "$contract_ref" --depth=1
  mkdir -p .contracts && git archive FETCH_HEAD contracts | tar -x -C .contracts
  cd mobile && flutter test test/contract_vectors_test.dart
  ```
- **`.flutter-plugins-dependencies` is now untracked.** It is generated and
  embedded the generating machine's pub-cache paths, including another
  developer's home directory.
- The widget test mocks the `flutter_secure_storage` and `package_info_plus`
  method channels. Without those stubs the router's async redirect throws and the
  app renders nothing, which is why the previous test asserted against a screen
  that never appeared.

## Follow-up tasks

- [ ] LAN discovery (mDNS/Bonjour) so outbound dialling has addresses.
- [ ] Interop test against a real desktop agent, once limitation #2 is decided.
- [ ] Remove the committed `contracts/`, `docs/`, `.codex/`, `DEV_GUIDE.md` copies.
- [ ] Rename `ci.yml` to `mobile-ci.yml`.
- [ ] Delete the stale `SCOPE_AUDIT.md`.
- [ ] Verify `flutter build apk` and an iOS compile still pass.
- [ ] Image sync end to end between two devices.

## For `main` (cross-domain, blocking interop)

1. **The LAN data-plane wire protocol is not a contract.** The handshake, frame
   format and content encoding live only in `desktop/internal/transport`. Mobile
   had to be written against desktop's source, which `DEV_GUIDE.md` §9 forbids
   ("do not depend on another domain's internal file paths"). This belongs in
   `docs/PROTOCOL.md` plus an ADR, with vectors, and it must settle whether a
   frame carries the `ClipboardEvent` envelope or raw content.
2. **`docs/CLIENT_RESPONSES.md` contradicts the normative schema.** Four examples
   show `publicKey` in 60-character SPKI form (`MCowBQYDK2VwAyEA…`), but
   `device.schema.json` and the OpenAPI document both require
   `^[A-Za-z0-9+/]{43}=$` — 44 characters, 32 raw bytes. The documented example
   would be rejected by the server. Already reported by `desktop`; still open.
3. **`DEV_GUIDE.md` §3.4's feature-branch convention cannot work.** Git refuses
   `refs/heads/mobile/<slug>` while `refs/heads/mobile` exists. This work used
   `mobile--p0-roster-and-transport-security`.
4. The `shared` branch is in the §2 branch map but does not exist on the remote.
