# Test Strategy

## Testing pyramid

```text
             E2E
            /   \
       Integration
          /     \
        Unit     Protocol
```

## Unit tests

Test:
- clipboard normalization.
- content hashing.
- event IDs.
- deduplication.
- sequence validation.
- loop prevention.
- authorization predicates.
- payload validation.

## Integration tests

Test:
- device registration.
- authenticated peer connection.
- clipboard propagation.
- reconnect.
- session membership.
- device revocation.

## Security tests

Test:
- unauthorized peer.
- fake device identity.
- replay.
- malformed envelope.
- oversized payload.
- expired authorization.
- revoked device.
- discovery spoofing.

## E2E

Minimum scenario:

```text
Device A copies text
        |
        v
Device B receives text
        |
        v
Device B OS clipboard contains text
```

Second scenario:

```text
A receives remote clipboard
        |
        v
A writes clipboard
        |
        v
A does NOT rebroadcast the same event
```

## Required CI gates

At minimum:

```text
format
lint
typecheck
unit
integration
build
```

Security-sensitive repositories should also run dependency/security scanning appropriate to the stack.

## Test data rule

Never use real passwords, API keys, private clipboard content, or personal data in tests.

Use synthetic fixtures.
