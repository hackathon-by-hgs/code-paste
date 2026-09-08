# Handoff — desktop

## Current State

Go agent. **Clipboard sync works end to end**: copy on one device, paste on another.

Verified against the live control plane with two paired devices — real Windows clipboard on one
side, in both directions, with no echo loop.

## What Works

- **Pairing** — `agent pair <CODE>` generates an Ed25519 keypair locally, redeems a code minted by
  the web app, and persists the device credentials.
- **Control-plane client** — stdlib only. Typed errors switching on `error.code`, token rotation
  behind a single-flight lock.
- **Roster verification** — signature over the raw bytes → parse → `self.deviceId` → version
  monotonicity → expiry. Every rejection path is tested.
- **Peer transport** — TCP carrying a station-to-station handshake (Ed25519 authentication over a
  transcript binding both ephemeral X25519 keys) then AES-256-GCM frames with per-direction keys
  and counters. Forward secret; signatures cannot be replayed across sessions.
- **Clipboard** — Windows (user32/kernel32 via syscall), macOS (pbcopy/pbpaste), Linux
  (wl-clipboard / xclip / xsel). Polled at 400ms with echo suppression.
- **Sync engine** — watch → send to authorized peers; receive → write locally.
- `agent peers` prints the verified roster.

## How Authorization Gates Sync

Three independent checks, all required, none sufficient alone:

1. **Discovery** says a device exists — an unverified claim from the network.
2. **The roster** says an identity is authorized — signed by the control plane.
3. **The handshake** proves the peer holds the private key for that identity.

Authorization is then re-checked at *delivery* time on both directions, so revoking a device drops
it from live connections rather than only from new ones.

## What Is Not Done

| Gap | Impact |
|---|---|
| **No mDNS.** Peers come from `CODEPASTE_PEERS` | Addresses must be configured. Security is unaffected — discovery only suggests where to knock. |
| **`crypto.FileStore` is not OS secure storage** | 0600 file, not Keychain/Credential Manager/libsecret. **Fix before shipping.** `KeyStore` is an interface so this is a one-file change. |
| **text/plain only** | Images are declared unsupported at pairing. The frame format already carries a content type. |
| **No realtime socket** (ADR-006) | Revocation still lands within the ≤5 min roster expiry; the socket only makes it faster. |
| **Single-machine testing needs the file backend** | Two agents on one host share one OS clipboard. `CODEPASTE_CLIPBOARD=file:<path>` gives the second agent somewhere independent to land. |

## Known Issues

1. **Windows clipboard `unsafe.Pointer` conversion.** `GlobalLock` returns a `uintptr` into Win32
   global heap, which is not GC-managed, so converting it is sound — but `go vet` cannot tell that
   case apart from a genuine misuse. CI runs `go vet -unsafeptr=false`; every other analyzer stays
   on, and `internal/clipboard` is the only package that touches `unsafe`.
2. **Simultaneous dial was a real bug**, found by running two agents rather than by a test. Both
   dialled each other, each closed "the duplicate", and both sessions died in a loop. Now the lower
   fingerprint dials and the higher one waits — deterministic, no negotiation. A regression test
   for this is still missing.
3. Poll interval is fixed at 400ms. Fine on desktop; revisit if it ever runs on battery.

## Contract Discrepancy Found

`docs/CLIENT_RESPONSES.md` §3 shows a device `publicKey` in 60-character SPKI form
(`MCowBQYDK2VwAyEA…`), which fails the OpenAPI pattern `^[A-Za-z0-9+/]{43}=$` — 44 characters, 32
raw bytes. The two disagree and the doc example would be rejected.

This agent emits the raw form per the OpenAPI file being authoritative. Confirmed empirically: a
registration with a deliberately bad pairing code returns `401 unauthenticated` (bad code), not
`400 invalid_request` (bad body), so the server accepted the encoding.

Worth fixing the example on `main` before another client copies it.

## Next Steps

1. Swap `FileStore` for OS secure storage. Highest priority — it is the one item that blocks
   giving this to anyone else.
2. Add mDNS so peers are found rather than configured.
3. Regression test for simultaneous dial.
4. Images: widen capabilities at pairing and honour the roster's `limits`.
5. Record the Go stack decision as an ADR on `main`, per `DEV_GUIDE.md` §4.
