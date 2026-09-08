# Desktop Clipboard Agent

The data-plane client: OS clipboard access, LAN discovery, and the peer transport that actually
moves clipboard content between devices.

Written in Go. Talks to the control plane described by `contracts/openapi/control-plane.yaml` on
`main`, pinned by `CONTRACTS_VERSION`.

> **Status: working.** Copy on one device, paste on another. Verified end to end against the live
> control plane. Credentials live in the OS credential store, and peers are found by mDNS or named
> explicitly. See `HANDOFF.md` for what is still unproven.

## How to run this domain in under 5 minutes

1. Install Go 1.24+.
2. Clone this branch:
   ```bash
   git clone git@github.com:hackathon-by-hgs/code-paste.git -b desktop --single-branch code-paste-desktop
   cd code-paste-desktop/desktop
   ```
3. Point it at the control plane (origin only — `/v1` is appended for you):
   ```bash
   export CODEPASTE_API_URL=https://code-paste.onrender.com
   ```
4. Build:
   ```bash
   go build -o bin/agent ./cmd/agent
   ```
5. Mint a pairing code in the web app (**Pair Device**), then redeem it. It is valid for 5 minutes
   and single-use:
   ```bash
   ./bin/agent pair K7M2QX9P "My Laptop"
   ```
6. On the second machine, repeat with its own code, then run each:
   ```bash
   ./bin/agent run
   ```
   They find each other over mDNS. If your network filters multicast, name the peer explicitly:
   ```bash
   export CODEPASTE_PEERS=192.168.1.42:47800
   ```

Copy something. It appears on the other machine's clipboard.

`agent peers` lists who is currently authorised; `agent status` reports local pairing state.

### Testing on one machine

Two agents on one host share a single OS clipboard, so that proves nothing. Point the second one
at a file instead:

```bash
# terminal 1 — real clipboard
CODEPASTE_LISTEN_PORT=47801 CODEPASTE_PEERS=127.0.0.1:47802 ./bin/agent run

# terminal 2 — file standing in for a second machine's clipboard
CODEPASTE_STATE_DIR=~/.agent2 CODEPASTE_CLIPBOARD=file:/tmp/clip2.txt   CODEPASTE_LISTEN_PORT=47802 CODEPASTE_PEERS=127.0.0.1:47801 ./bin/agent run
```

Copy on the desktop and `/tmp/clip2.txt` fills in; write that file and it lands on the real
clipboard. Each agent needs its own pairing code and its own `CODEPASTE_KEY_ACCOUNT`.

Add `CODEPASTE_MDNS=off` for this: two processes on one host cannot both receive on UDP 5353, so
the static peer list is the way to link them.

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
