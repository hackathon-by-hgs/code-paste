# ADR-005: Device Pairing Protocol

## Status

Accepted. Closes `SPEC_CONTRACT.md` gap #5.

Affects: `backend` (owner), `frontend`, `desktop`, `mobile`.

## Context

`SECURITY.md` states what pairing must *establish* — device identity, account ownership, protocol
version, capabilities, authorization relationship — and that it must use short-lived material and
never a permanent shared secret pasted into a terminal. It never states the actual exchange.

Meanwhile `RULES.md` §10 forbids making users copy tokens manually or run terminal commands, and
`PRODUCT_PRINCIPLES.md` applies the lazy-user test. So pairing must be both cryptographically sound
and close to one tap.

## Decision

A **short-lived, single-use pairing code**, minted by an authenticated session and consumed by the
agent.

```
1. Agent generates an Ed25519 keypair on first run. The private key never leaves the device.
2. User, signed in on the web app, taps "Add device".
      POST /v1/devices/pairing-codes   ->  { code: "K7M2QX9P", expiresInSeconds: 300 }
3. The code is displayed once.
4. User types it into the agent (8 characters, no login required in the agent).
5. Agent registers itself, presenting the code and its PUBLIC key:
      POST /v1/devices  { pairingCode, name, platform, appVersion, protocolVersion,
                          publicKey, capabilities }
   ->  201 { device, credentials: { accessToken, refreshToken, ... } }
6. The code is consumed atomically. The agent now holds device-bound credentials.
```

### Why this shape

- **The private key never transits.** Only the public half is registered, so the server cannot
  impersonate a device even if fully compromised.
- **The code authorises binding, not access.** It proves "the human who controls this account is
  standing at this device right now". It grants exactly one capability — bind one public key to
  this account — and expires in 300s.
- **Single-use, enforced in the database.** Consumption is a conditional `UPDATE ... WHERE
  consumed_at IS NULL` inside the registration transaction. Two agents racing on one code: exactly
  one wins. Not an application-level check-then-act.
- **Stored only as a hash**, like a password. A database read does not yield usable codes.
- **The alphabet excludes I, L, O and U.** The first three because they are misread as 1, 1 and 0;
  U so the code cannot spell an unfortunate word. 8 characters over a 32-symbol alphabet is 40 bits,
  and it is rate-limited and expiring, so brute force is not viable.

### Failure and abuse handling

| Case | Behaviour |
|---|---|
| Expired code | `401 unauthenticated`, no distinction from an unknown code |
| Already consumed | `401`, identical response — consumed and invalid are indistinguishable |
| Wrong code | `401`, rate-limited per IP and per account with exponential backoff |
| Duplicate public key for the account | `409 conflict` — one key fingerprint per user, enforced by a unique index |
| Unsupported protocol version | `422 unsupported_protocol_version`, listing what is supported |

Registration is **atomic**: consume the code, insert the device, issue credentials and bump peer
roster versions succeed or fail together. A partial failure that consumed a code but registered no
device would leave the user unable to retry with a code they already burned.

## Consequences

### Positive

- Meets every property `SECURITY.md` demands of pairing.
- Two taps and eight characters; no tokens, IPs, ports or terminal commands.
- Codes are useless once expired or used, and useless to an observer who lacks the account.
- Works identically on desktop and mobile.

### Negative

- The user types 8 characters. Not one tap. A QR path (web shows QR, phone scans) is the obvious
  MVP+1 improvement and needs no protocol change — the QR would simply encode the same code.
- Pairing requires an authenticated web session, so the first device needs a browser. Accepted:
  account creation already happens there.

## Rejected alternatives

**Agent logs in with email and password directly.** Simpler, and puts account credentials into
every client, including mobile, where they are hardest to protect. It also makes the agent a
credential-phishing target. The pairing code is strictly weaker material for a strictly narrower
purpose, which is the point.

**QR-only pairing.** Better UX, but a headless or remote-desktop setup has no camera. Keep the code
as the substrate; add QR as a presentation layer later.

**Auto-trust any device on the LAN during a pairing window.** Exactly the anti-pattern the spec
forbids: it makes network position an authorization boundary.

**Long-lived enrolment token in a config file.** A permanent shared secret on disk — explicitly
prohibited by `SECURITY.md`.
