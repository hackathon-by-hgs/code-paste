# Client Response Reference — Web and Mobile

What every control-plane endpoint returns, with concrete payloads and per-client guidance.

**Authority:** `contracts/openapi/control-plane.yaml` (pinned by `CONTRACTS_VERSION`). Where this
document and the OpenAPI file disagree, the OpenAPI file wins — it is the machine-checked one.

Base URL: `https://api.code-paste.example/v1` · local: `http://localhost:3000/v1`

---

## 0. Read this first

### Two token kinds, and they are not interchangeable

| | Browser token | Device token |
|---|---|---|
| Issued by | `/auth/login`, `/auth/signup` | `POST /devices` (registration) |
| JWT claims | `typ: "browser"`, no `did` | `typ: "device"`, `did: "cp_dev_…"` |
| Can manage the account | yes | yes |
| Can fetch a **peer roster** | **no** — `403` | yes |
| Can open the realtime socket | **no** — closed | yes |
| Can heartbeat | no | yes, for itself only |

The web app holds a browser token. A mobile app holds **both**: a browser token from login, then a
device token once it registers itself as a clipboard peer. If the mobile app never registers as a
device, it is an account-management client and nothing more.

### Universal response rules

- Every response is JSON except `204 No Content`.
- Every error has the identical shape (§8). Switch on `error.code`, **never** on `error.message` —
  messages are for humans and may be reworded without a version bump.
- **Unknown response fields must be tolerated.** New optional fields ship inside `/v1` (ADR-008).
  Do not use strict decoders that reject unknown keys — this is the single most common cause of a
  mobile client breaking on a backend deploy.
- All timestamps are RFC3339 UTC with milliseconds: `2026-09-07T12:00:00.000Z`.
- All ids are opaque strings with a type prefix (`cp_usr_`, `cp_dev_`, `cp_ses_`). Never parse
  them; never assume a length beyond the contract pattern.
- **No endpoint ever returns clipboard content or a private key.** If you think you need one, the
  design has gone wrong.

---

## 1. Protocol policy

### `GET /protocol` — unauthenticated

Call this **before** registering a device. It tells you whether your build is compatible, and it is
the authoritative source for payload size limits.

```json
{
  "apiVersion": "v1",
  "supportedProtocolVersions": [1],
  "currentProtocolVersion": 1,
  "contractsVersion": "protocol-v1.0.0",
  "limits": { "text/plain": 1048576, "image/png": 10485760, "image/jpeg": 10485760 }
}
```

**Web:** use it to show a "your app is out of date" banner.
**Mobile:** check at launch. If `currentProtocolVersion` exceeds what you implement, prompt for an
update rather than failing at registration.
**Do not hardcode the limits.** They are policy and may change without an API version bump.

---

## 2. Authentication

### `POST /auth/signup` → `201`

```json
{ "email": "ada@example.com", "password": "correct-horse-battery" }
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "refreshToken": "9f8e7d6c5b4a…",
  "tokenType": "Bearer",
  "expiresIn": 600,
  "user": { "id": "cp_usr_01h2xcejqtf2nbrexx3vqjhp40", "email": "ada@example.com",
            "createdAt": "2026-09-07T12:00:00.000Z" }
}
```

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Bad email, or password shorter than 12 characters. `error.details` names the field |
| 409 | `conflict` | Email already registered |
| 429 | `rate_limited` | Honour `Retry-After` |

### `POST /auth/login` → `200`

Same body shape as signup.

| Status | `error.code` | Meaning |
|---|---|---|
| 401 | `invalid_credentials` | Unknown email, wrong password, or disabled account — **deliberately indistinguishable** |
| 429 | `rate_limited` | Backs off exponentially per account |

Do not try to tell the user *which* part was wrong. The API will not tell you, on purpose.

### `POST /auth/refresh` → `200`

```json
{ "refreshToken": "9f8e7d6c5b4a…" }
```

Returns a **new** pair. The old refresh token is dead the instant this succeeds.

| Status | `error.code` | What the client must do |
|---|---|---|
| 401 | `token_expired` | Log the user out |
| 401 | `token_reused` | **Log out immediately and clear all stored tokens.** The whole family has been revoked because this token was already spent — treat it as a compromise signal |
| 401 | `unauthenticated` | Unknown or revoked token. Log out |

> **Serialise your refreshes.** Two concurrent refreshes with the same token means the second one
> is a reuse, and the server will revoke the family and log the user out. Use a single-flight lock
> so parallel 401s trigger one refresh that the others await. This is the number one integration
> bug with rotating tokens — on mobile especially, where several screens retry at once on
> reconnect.

### `POST /auth/logout` → `204`

Always `204`, even for an unknown token, so it cannot be used to test token validity. The access
token stays technically valid for up to its remaining TTL (≤10 min) — discard it client-side.

### `GET /auth/me` → `200`

```json
{
  "user": { "id": "cp_usr_01h2…", "email": "ada@example.com", "createdAt": "2026-09-07T12:00:00.000Z" },
  "principal": "device",
  "device": { "id": "cp_dev_01h2…", "name": "Ada's MacBook", "…": "…" }
}
```

`principal` is `"browser"` or `"device"`. `device` is present only for a device token. Use this to
decide whether to show peer/roster UI at all.

---

## 3. Device pairing and registration

### `POST /devices/pairing-codes` → `201` (browser token)

```json
{ "code": "K7M2QX9P", "expiresAt": "2026-09-07T12:05:00.000Z", "expiresInSeconds": 300 }
```

**Web:** display large and monospaced, with a live countdown. The code is returned **once** and is
not retrievable — if the user misses it, mint a new one. Never persist it.
**Mobile:** same, when the phone is the one showing the code.

### `POST /devices` → `201` (pairing code, no bearer token)

```json
{
  "pairingCode": "K7M2QX9P",
  "name": "Ada's iPhone",
  "platform": "ios",
  "appVersion": "1.0.0",
  "protocolVersion": 1,
  "publicKey": "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=",
  "capabilities": { "contentTypes": ["text/plain", "image/png"], "maxPayloadBytes": 5242880 }
}
```

```json
{
  "device": {
    "id": "cp_dev_01h2xcejqtf2nbrexx3vqjhp41",
    "name": "Ada's iPhone", "platform": "ios", "appVersion": "1.0.0", "protocolVersion": 1,
    "publicKey": "MCowBQYDK2VwAyEA…",
    "keyFingerprint": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "capabilities": { "contentTypes": ["text/plain", "image/png"], "maxPayloadBytes": 5242880 },
    "syncEnabled": true, "revoked": false, "revokedAt": null, "lastSeenAt": null,
    "createdAt": "2026-09-07T12:01:00.000Z"
  },
  "credentials": { "accessToken": "eyJ…", "refreshToken": "a1b2…", "tokenType": "Bearer",
                   "expiresIn": 600, "user": { "…": "…" } }
}
```

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed public key, unknown platform, bad capabilities |
| 401 | `unauthenticated` | Code wrong, expired, or already used — **all identical**, by design |
| 409 | `conflict` | This public key is already registered to this account. Reuse the existing device or generate a new keypair |
| 422 | `unsupported_protocol_version` | Your `protocolVersion` is not supported. `GET /protocol` says what is |
| 429 | `rate_limited` | Too many attempts |

**Both clients:** generate the Ed25519 keypair **before** calling this and store the private key in
platform secure storage — Keychain on iOS, Keystore on Android, Credential Manager / libsecret /
Keychain on desktop. The private key never leaves the device and is never sent anywhere. Store
`credentials` there too.

### `GET /devices` → `200`

```json
{
  "data": [ { "id": "cp_dev_01h2…", "name": "Ada's MacBook", "platform": "macos",
              "syncEnabled": true, "revoked": false, "lastSeenAt": "2026-09-07T12:04:30.000Z", "…": "…" } ],
  "nextCursor": null
}
```

Paginated: `?limit=50&cursor=…`. `nextCursor` is `null` on the last page — loop until it is null,
and treat the cursor as opaque. Revoked devices are excluded unless `?includeRevoked=true`.

**Web:** this is the device-management screen. Show `lastSeenAt` as relative time, and mark
`syncEnabled: false` clearly as *paused* rather than broken.
**Mobile:** same list; make "this device" visually distinct using `id` from `GET /auth/me`.

### `GET /devices/{id}` → `200`

A single `Device`. **`404 not_found` for another user's device** — never `403`. Do not interpret a
404 as "deleted"; it may simply not be yours.

### `PATCH /devices/{id}` → `200`

```json
{ "name": "Work laptop" }        // rename
{ "syncEnabled": false }         // the instant pause switch
```

Returns the updated device. `409 device_revoked` if the device is revoked — revoked devices are
immutable.

**Both clients:** `syncEnabled: false` is the "pause sync" control `RULES.md` §10 requires to be
easy to find. It takes effect at the next roster refresh (≤5 min), and immediately for peers with a
live socket. Say "pausing…" rather than implying it is already instant everywhere.

### `POST /devices/{id}/revoke` → `200`

Returns the device with `revoked: true` and `revokedAt` set. Atomically kills its tokens and drops
it from every peer roster. Idempotent.

**Web:** destructive — confirm explicitly, naming the device (`RULES.md` §10). After revoking the
device the user is *currently on*, clear local tokens and return to login.

### `DELETE /devices/{id}` → `204`

Revokes, then deletes. Gone from `GET /devices` entirely.

### `POST /devices/{id}/heartbeat` → `204` (device token, self only)

No request body, no response body. `403 forbidden` if the token is not bound to this device.

**Mobile:** call on foreground and on network regain — **not** on a background timer. iOS and
Android will not let you run one reliably, and the server coalesces writes to once per 5 minutes
anyway, so a tighter loop buys nothing.

---

## 4. Peer roster — device token only

### `GET /authz/peer-set` → `200`

```json
{
  "payload": "eyJwcm90b2NvbFZlcnNpb24iOjEsInJvc3RlclZlcnNpb24iOjQyLC…",
  "signature": { "algorithm": "ed25519", "keyId": "cp_rk_01h2xcejqtf2nbrexx3vqjhp4a",
                 "value": "3n2K…==" }
}
```

`payload` is base64 of the roster JSON:

```json
{
  "protocolVersion": 1,
  "rosterVersion": 42,
  "issuedAt": "2026-09-07T12:00:00.000Z",
  "expiresAt": "2026-09-07T12:05:00.000Z",
  "self": { "deviceId": "cp_dev_01h2…41", "userId": "cp_usr_01h2…40",
            "keyFingerprint": "sha256:9f86d081…" },
  "peers": [
    { "deviceId": "cp_dev_01h2…42", "userId": "cp_usr_01h2…40",
      "publicKey": "MCowBQYDK2VwAyEA…", "keyFingerprint": "sha256:2c26b46b…",
      "platform": "macos", "protocolVersion": 1,
      "capabilities": { "contentTypes": ["text/plain", "image/png"] },
      "scope": "personal", "sessionId": null }
  ],
  "limits": { "text/plain": 1048576, "image/png": 10485760, "image/jpeg": 10485760 }
}
```

**The verification sequence is mandatory and ordered:**

1. Fetch the signing keys from `GET /authz/roster-keys` (cache them).
2. Base64-decode `payload` to bytes.
3. Verify `signature.value` over **those exact bytes** with the key matching `signature.keyId`.
4. **Only now** parse the JSON.
5. Check `self.deviceId` equals your own device id — reject a roster issued to another device.
6. Check `rosterVersion` is **≥** the highest you have seen. A lower value is a rollback attempt;
   reject it and keep your current roster.
7. Check `expiresAt` is in the future.

Never parse before verifying. Never skip step 5 or 6.

**Using it:** a peer found via mDNS is authorized **only** if its `keyFingerprint` appears in
`peers` *and* it proves possession of the matching private key during your transport handshake.
Discovery says "this device exists"; the roster says "this identity is authorized"; the handshake
says "this really is that identity". All three, always.

**Refresh:** re-fetch before `expiresAt`, or on an `authorization.changed` socket event. When the
roster expires and you cannot reach the API, **stop syncing** — do not fall back to a cached
roster past expiry, and never fall back to trusting the LAN.

| Status | `error.code` | Meaning |
|---|---|---|
| 401 | `unauthenticated` | Access token missing or expired |
| 403 | `forbidden` | Browser token — a browser is not a clipboard peer |
| 403 | `device_revoked` | **Stop syncing, wipe local credentials, show "device removed"** |

### `GET /authz/roster-keys` → `200` — unauthenticated

```json
{ "keys": [ { "keyId": "cp_rk_01h2…", "algorithm": "ed25519", "publicKey": "MCowBQYDK2VwAyEA…" } ] }
```

Unauthenticated deliberately, so an agent can verify a cached roster while unable to authenticate.
Cache these; match on `keyId` so rotation does not break you.

---

## 5. Share sessions

### `POST /share-sessions` → `201`

```json
{ "expiresInSeconds": 3600 }
```

```json
{
  "id": "cp_ses_01h2xcejqtf2nbrexx3vqjhp42",
  "ownerUserId": "cp_usr_01h2…40",
  "status": "active",
  "expiresAt": "2026-09-07T13:00:00.000Z",
  "createdAt": "2026-09-07T12:00:00.000Z",
  "members": [ { "userId": "cp_usr_01h2…40", "email": "ada@example.com", "role": "owner",
                 "joinedAt": "2026-09-07T12:00:00.000Z", "revoked": false, "revokedAt": null } ],
  "joinCode": "R4TY8WQ2"
}
```

> `joinCode` appears **only** in this creation response. It is stored as a hash and can never be
> retrieved. If the user loses it, they create a new session.

**Both clients:** show the code with a countdown to `expiresAt`, and a prominent way to end sharing
early. `expiresInSeconds` is capped server-side (60–86400); do not offer a longer option.

### `GET /share-sessions` → `200`

`{ "data": [ ...ShareSession ], "nextCursor": null }` — same pagination as devices. Filter with
`?status=active`.

### `GET /share-sessions/{id}` → `200`

Full session including `members`, each with an `email`. **This is the "who can receive my clipboard
data" screen** required by `RULES.md` §10 — show every non-revoked member plainly.
`404` if you are not a member.

### `POST /share-sessions/{id}/join` → `200`

```json
{ "joinCode": "R4TY8WQ2" }
```

Returns the session. Idempotent for an existing member.

| Status | `error.code` | Meaning |
|---|---|---|
| 403 | `forbidden` | Wrong join code, or your membership was revoked (you cannot rejoin) |
| 404 | `not_found` | No such session |
| 409 | `session_expired` | Expired or revoked |
| 429 | `rate_limited` | Join attempts are rate-limited — do not retry in a loop |

### `POST /share-sessions/{id}/leave` → `204`

`403 forbidden` if you are the owner — an owner expires the session instead.

### `POST /share-sessions/{id}/revoke-member` → `200` (owner only)

```json
{ "userId": "cp_usr_01h2xcejqtf2nbrexx3vqjhp43" }
```

Returns the updated session. The revoked member drops out of every affected roster.

### `POST /share-sessions/{id}/expire` → `200` (owner only)

Returns the session with `status: "expired"`. Idempotent. **This is the "stop sharing" button.**

---

## 6. Realtime socket — device token only

`wss://api.code-paste.example/v1/realtime`

Every frame:

```json
{ "v": 1, "type": "authorization.changed", "id": "01h2xcejqtf2nbrexx3vqjhp4z",
  "ts": "2026-09-07T12:03:00.000Z", "data": { "reason": "device-revoked", "rosterVersion": 43 } }
```

**On connect:**

```json
{ "v": 1, "type": "connection.ready", "ts": "…",
  "data": { "deviceId": "cp_dev_01h2…41", "userId": "cp_usr_01h2…40", "protocolVersion": 1,
            "envelopeVersion": 1, "heartbeatIntervalSeconds": 30, "rosterVersion": 42 } }
```

Compare `rosterVersion` with your cached one — if the server's is higher, re-fetch immediately.

| Server → client | What to do |
|---|---|
| `connection.ready` | Start heartbeating at `heartbeatIntervalSeconds` |
| `pong` | Liveness confirmed |
| `authorization.changed` | Re-fetch the roster |
| `roster.invalidated` | Re-fetch the roster |
| `device.revoked` | **Stop syncing, wipe credentials, show "device removed".** The server closes the socket immediately after |
| `device.sync-toggled` | Sync was paused/resumed elsewhere; update UI and re-fetch |
| `session.membership.changed` | Re-fetch roster and session |
| `session.expired` | Stop sharing for that session; re-fetch roster |
| `protocol.unsupported` | Your build is too old; prompt for update |
| `error` | See codes below |

| Client → server | Purpose |
|---|---|
| `ping` | Heartbeat |
| `device.heartbeat` | Coalesced last-seen update |
| `roster.request` | Ask for a fresh roster out of band |
| `ack` | Acknowledge a correlated message |

**There is no message type in either direction that carries clipboard content.** The socket exists
to tell you your authorization is stale so you re-fetch a roster; clipboard data always moves
device-to-device (ADR-006).

**Limits:** max 2 connections per device, 20 per user, 8 KiB per message, 60 messages/minute. Five
malformed messages disconnects you.

**Reconnect:** exponential backoff with jitter, starting ~1s, capped ~60s. Do not reconnect in a
tight loop — you will hit the connection limit and be refused. On `device_revoked`, do **not**
reconnect at all.

**Missing the socket entirely is safe.** It is an optimisation: roster expiry (≤5 min) still
delivers revocation. Polling-only clients are correct, just slower to notice.

---

## 7. Pagination

Collections return `{ "data": [...], "nextCursor": string | null }`.

```
GET /devices?limit=50
GET /devices?limit=50&cursor=eyJjIjoiMjAyNi0wOS0wN1QxMjowMDowMFoifQ
```

Cursors are opaque, single-use for a given position, and not guaranteed stable across versions.
Never construct one; never assume offset semantics; loop until `nextCursor` is `null`.

---

## 8. Error shape — identical everywhere

```json
{ "error": { "code": "invalid_request", "message": "Request validation failed.",
             "details": [ { "path": "password", "message": "must be at least 12 characters" } ],
             "requestId": "01h2xcejqtf2nbrexx3vqjhp4x" } }
```

`details` appears only for `invalid_request`. `requestId` is safe to show in a support screen and
contains no user data.

| `error.code` | HTTP | Client action |
|---|---|---|
| `invalid_request` | 400 | Fix the request; show `details` inline on the offending field |
| `unauthenticated` | 401 | Refresh once, then log out |
| `invalid_credentials` | 401 | Show one generic "email or password is incorrect" |
| `token_expired` | 401 | Refresh, then retry once |
| `token_reused` | 401 | **Wipe tokens, log out.** Do not retry |
| `forbidden` | 403 | Not permitted; do not retry |
| `device_revoked` | 403 | **Stop syncing, wipe credentials** |
| `not_found` | 404 | Gone, or never yours |
| `conflict` | 409 | Duplicate; surface the specific case |
| `session_expired` | 409 | Sharing ended; refresh the UI |
| `not_a_member` | 403 | Not in this session |
| `payload_too_large` | 413 | Request body exceeded the cap |
| `unsupported_protocol_version` | 422 | Prompt for an app update |
| `rate_limited` | 429 | Back off using `Retry-After` |
| `internal` | 500 | Retry with backoff; show `requestId` |

**Never retry** `invalid_request`, `forbidden`, `device_revoked`, `token_reused`, `conflict` or
`not_found` — the outcome will not change.

---

## 9. Per-client checklists

### Web

- [ ] Browser token only; never attempt a roster fetch or a socket connection
- [ ] Single-flight refresh — never two concurrent `/auth/refresh` calls
- [ ] Tolerate unknown response fields
- [ ] Confirm destructive actions by name (revoke, delete, expire)
- [ ] Show, at all times: is sync on, which devices receive, is a session active, how to stop it
- [ ] Never log or persist a token, pairing code or join code
- [ ] Switch on `error.code`, never `error.message`

### Mobile

- [ ] Ed25519 keypair generated on-device; private key in Keychain/Keystore, never transmitted
- [ ] Both token kinds handled; only the device token opens the socket or fetches a roster
- [ ] Roster verified in the exact order in §4 — signature, then identity, then version, then expiry
- [ ] Stop syncing when the roster expires and cannot be refreshed. Never trust the LAN as a fallback
- [ ] Heartbeat on foreground and network regain, never on a background timer
- [ ] Reconnect with exponential backoff + jitter; never after `device_revoked`
- [ ] Lenient JSON decoding (unknown fields ignored)
- [ ] Honour `limits` from the roster, not hardcoded constants
- [ ] `GET /protocol` at launch; prompt for update on `unsupported_protocol_version`
- [ ] No clipboard content in logs, crash reports or analytics
