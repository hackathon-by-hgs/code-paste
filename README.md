# Desktop Clipboard Agent

The data-plane client: OS clipboard access, LAN discovery, and the peer transport that actually
moves clipboard content between devices.

Written in Go. Talks to the control plane described by `contracts/openapi/control-plane.yaml` on
`main`, pinned by `CONTRACTS_VERSION`.

> **Status: partial.** Pairing, device credentials and roster verification work against the live
> control plane. Clipboard, discovery and transport are interface stubs — **the agent does not sync
> clipboard content yet.** See `HANDOFF.md`.

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
   ./bin/agent run
   ```

`agent status` reports local pairing state.

## Checks

```bash
go vet ./...
go test -race ./...
gofmt -l .
```

## Layout

```
desktop/
├── cmd/agent/          CLI entrypoint
└── internal/
    ├── clipboard/      OS provider          — STUB
    ├── discovery/      LAN (mDNS)           — STUB
    ├── transport/      peer channel         — STUB
    ├── queue/          outbound buffer      — in-memory, non-durable by design
    ├── crypto/         Ed25519 identity + key store
    ├── controlplane/   API client + roster verification
    ├── config/         environment
    └── daemon/         wiring and the authorization loops
```

`DEV_GUIDE.md` §4 illustrates this as `desktop/src/...`. Go uses `internal/` instead: it is
idiomatic, and the compiler *enforces* the import restriction that `docs/RULES.md` §3.9 asks for
rather than leaving it to review. The mandated boundaries themselves are unchanged.

## Security notes

- The private key is generated on this machine and never transmitted. Only the public half reaches
  the control plane.
- **Nothing here ever sends clipboard content to the server.** No control-plane endpoint accepts it.
- Nothing logs clipboard content, keys, tokens or pairing codes at any level.
- Roster verification order is fixed and enforced in `internal/controlplane/roster.go`: signature
  over the raw bytes → parse → identity → version → expiry. Tests cover each rejection.
- Discovery is not authorization. A LAN peer counts only if the roster lists its fingerprint **and**
  it proves key possession in the transport handshake.

## Documentation

For architecture rules, protocols, and how this branch fits the multi-domain structure, see
`DEV_GUIDE.md` and `docs/` on the `main` branch — particularly ADR-001 (LAN-first),
ADR-002 (native agent), ADR-003 (roster distribution), ADR-005 (pairing) and ADR-006 (realtime).
