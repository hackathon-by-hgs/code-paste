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
- **Sync engine** — watch → send to authorized peers; receive → write locally. Items copied while
  no peer is connected are buffered and flushed on connect.
- **Background service** — `agent pair` installs and starts it, so setup is one command with no
  environment variables. Windows uses a hidden Startup-folder launcher, macOS a launchd
  LaunchAgent, Linux a systemd user unit. All user-scoped: the agent needs the user's session for
  the clipboard and the credential store, and installing needs no administrator rights.
- **Zero-configuration start** — the control-plane URL is compiled in by `build.sh`, and `pair`
  saves the resolved settings to `config.json`. A service starting at login has no shell to inherit
  an environment from, so nothing may depend on one.
- **Double-click setup** — a user who opens the .exe from Explorer gets an interactive prompt for
  the pairing code, not a usage screen that vanishes. `internal/tty` distinguishes "launched from
  Explorer" (this process owns the console) from "run in a shell", so shell behaviour is unchanged.
- `agent peers` prints the verified roster; `agent status` reports pairing, credential store and
  background state.

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
| **mDNS is unverified across machines** | Implemented and unit-tested, but two agents on one Windows host cannot both bind UDP 5353, so it could only be proven at the packet level here. Use `CODEPASTE_PEERS` for a single-host demo. |
| **text/plain only** | Images are declared unsupported at pairing. The frame format already carries a content type. |
| **No realtime socket** (ADR-006) | Revocation still lands within the ≤5 min roster expiry; the socket only makes it faster. |
| **Single-machine testing needs the file backend** | Two agents on one host share one OS clipboard. `CODEPASTE_CLIPBOARD=file:<path>` gives the second agent somewhere independent to land. |

## Credential Storage

Credentials live in the platform credential store: **Windows Credential Manager** (advapi32),
**macOS Keychain** (`security`), **Linux libsecret** (`secret-tool`). An identity found in the old
0600 file store is migrated in and the file deleted, so existing agents do not re-pair.

The file store survives only as a fallback for a machine with no keyring — a headless Linux box,
typically — and the agent prints a warning when it lands there rather than falling back silently.

## Discovery

mDNS/DNS-SD (`_codepaste._tcp.local`), implemented over raw multicast with no dependencies, plus the
static `CODEPASTE_PEERS` list. They are complements: mDNS makes the common case seamless, while a
configured address still reaches a peer on another subnet or a network that filters multicast.

Sockets open on **every** multicast-capable interface. Letting the system choose was the difference
between working and silent on the dev machine: the default interface was a VPN adapter with no peers
on it, while the real LAN was on Wi-Fi.

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
4. **Windows uses the Startup folder, not a Scheduled Task.** A task restarts on crash and would be
   the better mechanism, but `schtasks /create` returns "Access is denied" without elevation on a
   default Windows 11 install, and a UAC prompt between the user and a working clipboard defeats
   the point. The Startup folder needs no elevation; the cost is that a crashed agent returns at the
   next login rather than immediately.
5. **macOS and Linux service backends are unverified.** Written against launchd and systemd
   documentation, compiled for both targets, but never run — there was no machine to run them on.
   The Windows path is verified end to end.
6. **mDNS is not verifiable on a single Windows host.** Two processes cannot both receive on UDP
   5353 — the second gets nothing. Confirmed with an isolated two-process test, so it is a platform
   limitation rather than a bug here, but cross-machine discovery remains unproven. Verify on two
   machines before relying on it.
7. Images are still declared unsupported at pairing; the frame format already carries a content type.
8. `agent install` points the login entry at the binary's current path. Move the binary and the entry
   breaks; re-run `install` after relocating it.

## Contract Discrepancy Found

`docs/CLIENT_RESPONSES.md` §3 shows a device `publicKey` in 60-character SPKI form
(`MCowBQYDK2VwAyEA…`), which fails the OpenAPI pattern `^[A-Za-z0-9+/]{43}=$` — 44 characters, 32
raw bytes. The two disagree and the doc example would be rejected.

This agent emits the raw form per the OpenAPI file being authoritative. Confirmed empirically: a
registration with a deliberately bad pairing code returns `401 unauthenticated` (bad code), not
`400 invalid_request` (bad body), so the server accepted the encoding.

Worth fixing the example on `main` before another client copies it.

## Next Steps

1. Verify the macOS and Linux service backends on real machines.
2. Verify mDNS between two real machines.
3. Regression tests for simultaneous dial and for the duplicate-session rule.
4. Images: widen capabilities at pairing and honour the roster's `limits`.
5. Record the Go stack decision as an ADR on `main`, per `DEV_GUIDE.md` §4.
