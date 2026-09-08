# Desktop Agent Rules

For all general operating contracts, rules, system design, and AI agent instructions, **see `CLAUDE.md` on the `main` branch**.

This file is a thin pointer as mandated by the `DEV_GUIDE.md`.

## Domain-Specific Rules (Desktop)
- The agent is written in **Go**. Standard library only in `internal/controlplane` and
  `internal/crypto` — those paths are security-critical and must stay auditable.
- This domain owns the **data plane**: OS clipboard access, LAN discovery, and the peer transport.
  It is the only domain that moves clipboard content.
- **No clipboard content ever goes to the control plane.** No API call in
  `contracts/openapi/control-plane.yaml` accepts, returns or relays a payload. If you find yourself
  wanting to POST clipboard data, the design has gone wrong.
- **Never log clipboard content, private keys, pairing codes or tokens.** Not at debug level, not
  in a crash dump.
- The private key never leaves the machine. It is generated locally and stored in OS secure
  storage.
- Roster verification order is not negotiable: verify the signature over the raw bytes, *then*
  parse, then check identity, then version, then expiry. Never parse before verifying.
- Discovery is not authorization. A peer found on the LAN is authorized only if its
  `keyFingerprint` is in the current roster **and** it proves possession of the matching private
  key during the transport handshake.
- Do not couple to `frontend` or `backend` internals (`docs/RULES.md` §3.8). The pinned contract in
  `CONTRACTS_VERSION` is the only interface.
