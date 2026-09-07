# Agent Handoff

## Agent

`principal-engineer / control-plane`

## Date

2026-09-07

## Milestone

Contracts established on `main`; backend control plane implemented on `backend`.

## Objective

Close the specification gaps recorded in `docs/SPEC_CONTRACT.md` §20 that were blocking every
domain, and deliver the backend against the contracts that result.

---

## Completed

**On `main`** (PR #1, branch `contracts/v1-gap-closures`):

- `contracts/` — `VERSION`, five JSON schemas, an OpenAPI 3.1 document (19 paths, 23 operations,
  26 schemas), and 28 conformance vectors.
- `docs/SPEC_CONTRACT.md` — all twelve source documents consolidated into one normative contract.
- `docs/CLIENT_RESPONSES.md` — every endpoint's response shape, for web and mobile.
- `docs/ADR-003` … `ADR-008`.

**On `backend`** (pushed, branch `backend`): the control plane. 21 test suites, 243 tests, all
seven CI gates green locally.

---

## Architecture decisions

| ADR | Decision | Affects |
|---|---|---|
| 003 | Signed peer roster distribution | `desktop`, `mobile`, `shared`, `backend` |
| 004 | Authentication and token semantics | all clients |
| 005 | Device pairing protocol | `frontend`, `desktop`, `mobile` |
| 006 | Realtime control channel | `desktop`, `mobile` |
| 007 | PostgreSQL, Drizzle, repositories and mappers | `backend` only |
| 008 | API and protocol versioning | all domains |

**ADR-003 is the load-bearing one.** The docs required cryptographic peer verification and prompt
revocation but never said how a device learns which peer keys are authorized. Without an answer,
an agent that discovers a peer over mDNS has no basis for a trust decision, and the tempting
fallback is "same network" — the one thing the spec forbids absolutely.

The answer is a short-lived signed roster: **authorization expires rather than being revoked**, so
revocation needs no delivered message and no broker, and LAN sync survives a control-plane outage
up to the TTL.

---

## Tests run

Contract vectors, with `format` support both enabled and disabled (simulating a non-JavaScript
validator):

```
valid:   6 accepted
invalid: 22 rejected — 18 by schema, 4 semantic-only
ALL VECTOR LABELS CORRECT
```

OpenAPI: `paths: 19 | operations: 23 | schemas: 26 | broken refs: 0`.

Backend: `21 suites, 243 tests, 0 failures`; format, lint, typecheck and build clean. Full output
in `HANDOFF.md` on the `backend` branch.

---

## Security review

- **`vectors/invalid/` carries a `rejectedBy` discriminator.** Four cases — hash mismatch,
  declared/actual size mismatch, per-type size limits, non-base64 image payload — are **accepted by
  JSON Schema alone**. A domain that only runs schema validation will silently accept a tampered
  payload. Implement the semantic layer.
- **Rosters are signed over bytes, not over an object.** Verifying a signature on a JSON object
  needs canonicalisation (RFC 8785); divergent canonicalisation across Rust, Swift and Kotlin is a
  near-certain signature-bypass bug. The contract removes the failure class.
- **Rollback protection** via a monotonic `rosterVersion`; **replay protection** via `self.deviceId`
  inside the signed payload.
- Three real bugs were found and fixed in the backend by its own security suite; see `HANDOFF.md`
  on `backend`.

---

## Known limitations

- Revocation has a bounded residual window of one roster TTL (300 s default) for a device offline
  from the realtime channel. Accepted in ADR-003.
- Backend rate limiting and realtime connection state are in-process; single-instance only for now.
- The backend's production `pg` driver path is unverified locally (no Docker on the machine used);
  CI's `postgres` matrix leg is its first real execution.

---

## Next agent should know

### `main` owner — action required

1. **Tag `protocol-v1.0.0` on `main` after merging PR #1.** `DEV_GUIDE.md` §5.4 puts tagging after
   the PR, so the tag is deliberately not pushed. **Every domain's `CONTRACTS_VERSION` pin is inert
   until it exists**, and the backend's contract-conformance CI job cannot run.

2. **`DEV_GUIDE.md` §3.4's feature-branch convention cannot work.** Git refuses
   `refs/heads/main/<slug>` while `refs/heads/main` exists — a ref cannot be both a file and a
   directory:

   ```
   $ git switch -c main/contracts-v1-gap-closures
   fatal: cannot lock ref 'refs/heads/main/contracts-v1-gap-closures':
          'refs/heads/main' exists; cannot create ...
   ```

   This affects every documented example, including `backend/feat-device-registration` and
   `desktop/fix-clipboard-loop-on-wake`. PR #1 used `contracts/v1-gap-closures` as a workaround.
   Suggested replacement: `<domain>--<slug>` or `feat/<domain>-<slug>`.

### `desktop` and `mobile`

- Implement roster verification (ADR-003) in this exact order: verify the signature over the
  decoded bytes → parse → check `self.deviceId` is yours → check `rosterVersion` has not gone
  backwards → check `expiresAt`. **Never parse before verifying.**
- A peer found via mDNS is authorized **only** if its `keyFingerprint` is in `peers` *and* it proves
  possession of the matching private key in your transport handshake. Discovery, authorization and
  cryptographic verification are three separate things.
- When a roster expires and cannot be refreshed, **stop syncing**. Never fall back to trusting the
  LAN.
- Implement the semantic validation layer for clipboard events; the schema is not sufficient.
- Honour the `limits` from the roster rather than hardcoding them.
- Pairing (ADR-005): generate the Ed25519 keypair on-device, store the private key in platform
  secure storage, register only the public half.

### `frontend`

- Pairing-code display (shown once, never retrievable) and the session membership view, which must
  answer "who can receive my clipboard data" (`RULES.md` §10).
- Browser tokens cannot fetch a roster or open the realtime socket, by design — do not try.
- **Serialise refreshes.** Two concurrent `/auth/refresh` calls with the same token trip reuse
  detection and log the user out.

### `shared`

- Protocol types and validation for the clipboard event, plus the semantic checks the vectors
  require.

---

## Follow-up tasks

- [ ] `main`: merge PR #1, then tag `protocol-v1.0.0`
- [ ] `main`: fix `DEV_GUIDE.md` §3.4 branch naming
- [ ] `main`: decide whether `/v1/health` belongs in the OpenAPI contract
- [ ] `shared`, `desktop`, `mobile`: clipboard-event semantic validation against the vectors
- [ ] `desktop`, `mobile`: roster verification and pairing
- [ ] `frontend`: pairing-code and session membership UI

## Integration notes

Base URL `/v1`. Two token kinds — `browser` and `device` — are **not** interchangeable; only a
device token may fetch a roster, heartbeat or open the socket.

New cross-domain surfaces introduced by this work:

```
GET  /v1/authz/peer-set      signed roster        device token   (desktop, mobile)
GET  /v1/authz/roster-keys   verification keys    public         (desktop, mobile)
POST /v1/devices/pairing-codes                    browser token  (frontend)
POST /v1/devices             registration         pairing code   (desktop, mobile)
WS   /v1/realtime            control channel      device token   (desktop, mobile)
```

`docs/CLIENT_RESPONSES.md` documents every response shape, error code and client action for both
web and mobile.
