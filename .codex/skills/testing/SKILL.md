# Skill: Testing

## Rule

A feature without tests is incomplete.

## Prioritize behavior over implementation details

Test contracts such as:

```text
copy -> send -> receive -> paste
```

rather than private function implementation.

## Clipboard-specific cases

Always consider:
- empty clipboard.
- same content copied twice.
- large text.
- image.
- unsupported type.
- remote write.
- loop prevention.
- simultaneous copies.
- device disconnect.
- reconnect.
- session expiry.
- device revocation.

## Network-specific cases

Always consider:
- malformed packet.
- spoofed discovery.
- unauthenticated peer.
- replay.
- timeout.
- partial message.
- connection reset.
- API outage.
- LAN outage.

## Before merge

No known failing relevant test may be ignored without an explicit documented reason.
