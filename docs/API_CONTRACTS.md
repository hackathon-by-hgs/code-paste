# API Contracts

The API is the control plane.

It should not receive LAN clipboard payloads in the normal LAN path.

## Authentication

Endpoints:

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
```

Exact authentication mechanism is implementation-specific.

## Devices

```text
POST   /devices
GET    /devices
GET    /devices/:id
DELETE /devices/:id
POST   /devices/:id/revoke
```

Device registration should include:
- device name.
- platform.
- app version.
- protocol version.
- public key.
- capabilities.

## Sharing

```text
POST   /share-sessions
GET    /share-sessions
GET    /share-sessions/:id
POST   /share-sessions/:id/join
POST   /share-sessions/:id/leave
POST   /share-sessions/:id/revoke-member
POST   /share-sessions/:id/expire
```

## Discovery/signaling

Future-compatible endpoints:

```text
POST /signaling/offer
POST /signaling/answer
POST /signaling/ice
```

Do not implement signaling until the LAN transport needs it.

## API rules

- Validate every request.
- Return stable error codes.
- Never return private keys.
- Never return clipboard contents.
- Never expose internal database IDs if opaque public IDs are preferable.
- Enforce authorization server-side.
- Do not rely on UI restrictions for security.
