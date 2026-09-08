# Desktop Clipboard Agent

The data-plane client: OS clipboard access, LAN discovery, and the peer transport that actually
moves clipboard content between devices.

Written in Go. Talks to the control plane described by `contracts/openapi/control-plane.yaml` on
`main`, pinned by `CONTRACTS_VERSION`.

> **Status: working.** Copy on one device, paste on another. Verified end to end against the live
> control plane. Credentials live in the OS credential store, and peers are found by mDNS or named
> explicitly. See `HANDOFF.md` for what is still unproven.

## How to run this domain in under 5 minutes

### For a user

Copy the binary for your platform from a release build (below), then:

```bash
./agent pair K7M2QX9P
```

That is the whole setup. It registers the device, starts syncing in the background, and starts again
at every login. No environment variables, no terminal left open.

Mint the code under **My Devices** in the web app; it lasts 5 minutes and is single-use. Each machine
needs its own — one identity per device is the security model, not an oversight.

```bash
./agent status      # pairing, credential store, background state
./agent peers       # who may currently receive this clipboard
./agent uninstall   # stop starting at login (pairing is kept)
./agent run         # sync in this terminal instead of the background
```

### For a developer

```bash
git clone git@github.com:hackathon-by-hgs/code-paste.git -b desktop --single-branch code-paste-desktop
cd code-paste-desktop/desktop

# Release build: bakes the control-plane URL in, cross-compiles to ../dist
./build.sh https://code-paste.onrender.com

# Or run from source, supplying the URL yourself
export CODEPASTE_API_URL=https://code-paste.onrender.com
go run ./cmd/agent pair K7M2QX9P --no-service
go run ./cmd/agent run
```

### Testing on one machine

Two agents on one host share a single OS clipboard, so that proves nothing. Point the second at a
file instead, and give it its own credential-store entry:

```bash
# terminal 1 — real clipboard
CODEPASTE_LISTEN_PORT=47801 CODEPASTE_PEERS=127.0.0.1:47802 ./agent run

# terminal 2 — file standing in for a second machine's clipboard
CODEPASTE_KEY_ACCOUNT=agent2 CODEPASTE_CLIPBOARD=file:/tmp/clip2.txt   CODEPASTE_LISTEN_PORT=47802 CODEPASTE_PEERS=127.0.0.1:47801 ./agent run
```

Copy on the desktop and `/tmp/clip2.txt` fills in; write that file and it lands on the real
clipboard. Add `CODEPASTE_MDNS=off`: two processes on one host cannot both receive on UDP 5353, so
the static peer list is what links them.

## Checks

```bash
go vet -unsafeptr=false ./...   # see HANDOFF.md for why
go test -race ./...
gofmt -l .
```

## Layout

```
desktop/
├── cmd/agent/          CLI entrypoint
└── internal/
    ├── clipboard/      OS provider (Windows/macOS/Linux) + file backend for tests
    ├── discovery/      mDNS/DNS-SD + a static peer list
    ├── transport/      TCP + station-to-station handshake + AES-256-GCM frames
    ├── queue/          outbound buffer      — in-memory, non-durable by design
    ├── crypto/         Ed25519 identity + OS credential store
    ├── service/        background service (Startup folder / launchd / systemd)
    ├── controlplane/   API client + roster verification
    ├── config/         environment
    └── daemon/         wiring and the authorization loops
```

`DEV_GUIDE.md` §4 illustrates this as `desktop/src/...`. Go uses `internal/` instead: it is
idiomatic, and the compiler *enforces* the import restriction that `docs/RULES.md` §3.9 asks for
rather than leaving it to review. The mandated boundaries themselves are unchanged.

## Security notes

- The private key is generated on this machine and never transmitted. Only the public half reaches
  the control plane. It is held in the OS credential store — Credential Manager, Keychain or
  libsecret — never a plain file unless the machine has no keyring, and the agent says so when that
  happens.
- **Nothing here ever sends clipboard content to the server.** No control-plane endpoint accepts it.
- Nothing logs clipboard content, keys, tokens or pairing codes at any level.
- Roster verification order is fixed and enforced in `internal/controlplane/roster.go`: signature
  over the raw bytes → parse → identity → version → expiry. Tests cover each rejection.
- Discovery is not authorization. A LAN peer counts only if the roster lists its fingerprint **and**
  it proves key possession in the transport handshake — and that is re-checked at delivery time, so
  revocation reaches connections that are already open.
- Peer traffic is encrypted with per-session keys from an ephemeral X25519 exchange, so recovering a
  device key later does not decrypt captured traffic.

## Documentation

For architecture rules, protocols, and how this branch fits the multi-domain structure, see
`DEV_GUIDE.md` and `docs/` on the `main` branch — particularly ADR-001 (LAN-first),
ADR-002 (native agent), ADR-003 (roster distribution), ADR-005 (pairing) and ADR-006 (realtime).
