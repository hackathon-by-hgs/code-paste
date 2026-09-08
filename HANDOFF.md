# Handoff — desktop

## Current State

New domain branch. Go agent, scaffolded with a working control-plane client.

**The agent does not sync clipboard content yet.** It pairs, holds device credentials, and keeps a
verified peer roster current. The three packages that would actually move data — `clipboard`,
`discovery`, `transport` — are interface stubs.

That order is deliberate: authorization has to be correct before a single byte moves, and it is the
part with real security consequences if rushed.

## What Works

- **Pairing** — `agent pair <CODE>` generates an Ed25519 keypair locally, redeems a code minted by
  the web app, and persists the returned device credentials. Verified against the live control
  plane.
- **Control-plane client** (`internal/controlplane`) — stdlib only. Typed errors switching on
  `error.code`, and token rotation behind a single-flight lock.
- **Roster verification** (`internal/controlplane/roster.go`) — the full mandated sequence, with a
  test for every rejection path.
- **Daemon loops** (`internal/daemon`) — roster refresh ahead of expiry, heartbeat on the 5-minute
  coalescing window, and a hard stop on `device_revoked` / `token_reused`.
- `go vet`, `go build` and `go test` all pass. CI additionally runs `-race` and cross-compiles for
  darwin/arm64, darwin/amd64, windows/amd64 and linux/amd64.

## What is Stubbed

| Package | State | Needs |
|---|---|---|
| `clipboard` | interface + `Unsupported` | Per-platform backend: NSPasteboard, Win32 clipboard, X11/Wayland. Must coalesce changes and not re-emit content it just wrote, or two devices ping-pong the same item forever. |
| `discovery` | interface + `Disabled` | mDNS/DNS-SD announce and browse. |
| `transport` | interface + `Disabled` | Encrypted peer channel with mutual proof-of-possession over a **per-connection challenge**. Must stay relay-compatible (`RULES.md` §3.5). |
| `queue` | working in-memory ring | Nothing. It is intentionally non-durable — persisting clipboard content to disk would create the history this product exists to avoid. Changing that needs an ADR. |

Not implemented at all: the realtime socket (ADR-006). It is an optimisation — roster expiry of
≤5 minutes still delivers revocation, so a polling-only agent is correct, just slower to notice.

## Known Issues

1. **`crypto.FileStore` is not production-safe.** It is a 0600 file, not OS secure storage. It
   protects against other users on the machine, not against anything running as this user. The
   contract requires Keychain / Credential Manager / libsecret. `KeyStore` is an interface precisely
   so this can be swapped without touching the daemon. **Do this before shipping to anyone.**
2. **No `go.sum` yet** because there are no third-party dependencies. Adding the clipboard and mDNS
   libraries will create one; the CI cache key already points at it.
3. Capabilities are hardcoded to `["text/plain"]` at pairing. Widen once the transport can carry
   images, and honour the limits from `GET /protocol` rather than any constant.

## Contract Discrepancy Found

`docs/CLIENT_RESPONSES.md` §3 shows a device `publicKey` of
`"MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE="` — 60 characters, an SPKI/DER
encoding. The OpenAPI schema requires `^[A-Za-z0-9+/]{43}=$`, i.e. 44 characters: 32 raw bytes,
base64. **The two disagree and the doc example would fail validation.**

This agent emits the raw form, per the OpenAPI file being authoritative. Confirmed empirically: a
registration attempt with a deliberately invalid pairing code returns `401 unauthenticated` (bad
code) rather than `400 invalid_request` (bad body), so the server accepted the key encoding.

Worth fixing the example on `main` before another client copies it.

## Next Steps

1. Swap `FileStore` for OS secure storage.
2. Implement `clipboard` for one platform — enough for a demo.
3. Implement `discovery` (mDNS), then `transport` with the challenge-response handshake.
4. Wire the sync path in `daemon`: watch → queue → send to authorized peers; receive → write.
5. Record the Go stack decision as an ADR on `main`, per `DEV_GUIDE.md` §4.
6. Add the `desktop` row to the branch map if it is ever removed — it is already there.
