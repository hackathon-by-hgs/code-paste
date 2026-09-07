# Skill: Clipboard Security Review

## Purpose

Review changes involving identity, networking, clipboard payloads, storage, or permissions.

## Checklist

### Identity
- Device has a cryptographic identity.
- Private key remains private.
- Public identity is bound to account/device.

### Authorization
- Same network is not treated as trust.
- Session membership is checked.
- Device revocation is checked.

### Transport
- Authenticated.
- Encrypted.
- Replay resistant.
- Payload limits enforced.

### Privacy
- No clipboard contents in logs.
- No clipboard contents in analytics.
- No unnecessary persistence.
- Temporary buffers expire.

### Input
- Validate all fields.
- Validate content type.
- Validate declared/actual size.
- Reject malformed packets.

### Abuse
- Rate limiting where appropriate.
- Connection limits.
- Session expiry.
- Reconnect backoff.

## Stop conditions

Reject the change if it:
- broadcasts raw clipboard contents on LAN,
- accepts arbitrary unauthenticated peers,
- logs clipboard contents,
- invents custom cryptography,
- stores unlimited clipboard history by default.
