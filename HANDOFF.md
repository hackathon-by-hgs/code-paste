# Handoff — Mobile

## Current State

### Implemented
- Flutter project structure scaffolded
- Basic app configuration in `pubspec.yaml`
- Platform support: iOS, Android, web, Linux, macOS, Windows
- Test framework scaffolded

### In Progress / Stubbed
- Clipboard integration (platform-specific)
- LAN discovery
- Device registration and pairing
- Authentication/authorization flows
- Security/crypto implementation
- Protocol compliance testing

## Architecture Notes

The mobile domain is responsible for:
- iOS and Android native clipboard integration
- Platform-appropriate UI for device pairing and sharing
- Local clipboard monitoring within OS constraints
- Secure peer transport implementation
- Contract conformance validation

See `CLAUDE.md` for the multi-agent operating contract.
See `main` branch for `docs/SYSTEM_DESIGN.md` and `docs/RULES.md`.

## Next Steps

1. Implement iOS clipboard integration via Swift
2. Implement Android clipboard integration via Kotlin
3. Add device discovery and pairing UI
4. Implement sharing session UI
5. Add security/crypto layer
6. Conformance testing against `contracts/vectors/`

## Known Issues

- None yet

## Dependencies

- Docs and contracts on `main` branch
- Protocol definitions in `contracts/` (pinned via `CONTRACTS_VERSION`)
