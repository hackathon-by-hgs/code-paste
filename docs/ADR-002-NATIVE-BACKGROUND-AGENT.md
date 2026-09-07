# ADR-002: Native Background Agent

## Status

Accepted

## Context

The product wants clipboard synchronization to happen automatically after setup.

Web browsers cannot reliably monitor the operating-system clipboard in the background.

## Decision

Use a native/background-capable agent as the primary seamless client.

The web app manages the account and configuration.

Mobile clients must use platform-approved clipboard/share capabilities.

## Consequences

### Positive

- Real background behavior where the OS permits it.
- Better OS clipboard integration.
- Better LAN networking.
- Clear separation between UI and background service.

### Negative

- Multiple platform implementations.
- OS-specific permission constraints.
- More packaging/distribution work.

## Rule

Never fake background behavior with a browser tab or hidden polling loop.
