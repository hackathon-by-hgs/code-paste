# Cross-Device Clipboard

A simplicity-first clipboard synchronization system.

## Vision

Copy on one device.

Paste on another.

No manual networking configuration.

## Architecture

- Web: account/device/sharing management.
- Desktop: seamless background clipboard agent.
- Mobile: platform-approved clipboard/share integration.
- API: identity and authorization control plane.
- LAN: encrypted local clipboard data plane.
- Future: remote relay.

## Important security principle

Being on the same Wi-Fi is not enough to receive clipboard data.

Only explicitly authorized users/devices may receive it.

## Documentation

Start with:

1. `CLAUDE.md`
2. `DEV_GUIDE.md` — repository/branch layout and how to check out a domain
3. `docs/SYSTEM_DESIGN.md`
4. `docs/RULES.md`
5. `docs/SECURITY.md`
6. `docs/PROTOCOL.md`

Agents should also read `.codex/skills/*` relevant to their task.
