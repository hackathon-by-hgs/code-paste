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

## Android APK release workflow

- CI now runs Flutter commands from `mobile`, pins Flutter 3.38.9, and uses Java 17.
- Builds ARMv7, ARM64, and x86_64 APKs and uploads them with checksums as artifacts.
- Successful checks and builds on `mobile` publish a GitHub prerelease for the exact commit.
- Pull requests only upload artifacts; publication has job-scoped contents-write access.
- Contract extraction now fails on errors; vector tests remain unimplemented.
- YAML parsing and whitespace checks passed. The local formatting check reports 25
  source files requiring formatting, so publication remains gated on resolving that
  and any analysis/test failures. APK compilation and GitHub publication were not run locally.
- APK signing remains the project's debug signing configuration.

## CI verification preparation

- Cleared formatting and analyzer findings without weakening CI checks.
- Replaced the obsolete counter test with splash-to-login and input validation coverage.
- Pinned contracts to existing commit 0f805953673ac29da14a32952e3888afda945be6 because protocol-v1.0.0 is not published as a remote tag.
- Local analyzer: no issues. Widget tests: 3 passed. Actionlint and contract archive checks passed.
- Branch for publishing: mobile only.
