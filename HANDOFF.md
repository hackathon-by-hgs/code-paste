# Handoff — Mobile

## Current State (After Implementation Sessions)

### Phase Completion Status

#### Phase 1-4: COMPLETE ✅
- ✅ Authentication & Device Registration (full auth flow with secure storage)
- ✅ Backend API Integration (all endpoints implemented)
- ✅ Peer Discovery (roster fetching with signature verification framework)
- ✅ Clipboard Sync & LAN Transport (complete with message framing, deduplication, validation)

### Core Features Implemented
- ✅ Flutter Cupertino UI (full Apple styling, no Material Design)
- ✅ Auth flow: Login → Signup → Device Setup
- ✅ Secure token storage (flutter_secure_storage)
- ✅ RSA-2048 key generation and storage
- ✅ API client with bearer token injection and 401 refresh
- ✅ ClipboardEvent model with full schema validation (per contracts/)
- ✅ Event deduplication system (prevents echo loops)
- ✅ iOS/Android clipboard method channels (registered + implemented)
- ✅ LAN transport with TCP message framing (length-prefixed protocol)
- ✅ Secure logging (no clipboard data exposure)
- ✅ Peer roster signature verification framework (ready for Ed25519)
- ✅ Payload size enforcement (10MB limit per spec)

### Security Implementation
- ✅ Event validation against JSON schema
- ✅ Deduplication cache for replay prevention
- ✅ Secure logging throughout (SecureLogging utility)
- ✅ Ed25519 signature verification interface (framework for dart_ed25519)
- ⏳ RSA message encryption (stubs in place, ready for implementation)

### In Progress / Next
- ⏳ Ed25519 signature verification (needs dart_ed25519 package + backend keys)
- ⏳ RSA message encryption (pointycastle integration)
- ⏳ End-to-end device testing
- ⏳ Integration with production backend

## Architecture Overview

### Files Structure
```
mobile/
├── lib/
│   ├── screens/          # Cupertino UI screens (auth, home)
│   ├── services/         # Core services (auth, discovery, transport, clipboard)
│   ├── models/           # Data models (peer, clipboard event, app state)
│   ├── providers/        # State management (HomeProvider)
│   ├── utils/            # Utilities (logging, crypto, crypto_verification)
│   ├── routes/           # Navigation (GoRouter)
│   ├── config/           # App configuration
│   └── widgets/          # Reusable Cupertino widgets
├── ios/                  # iOS-specific code (AppDelegate.swift, native clipboard)
├── android/              # Android-specific code (MainActivity.kt, native clipboard)
├── test/                 # Unit & widget tests
├── HANDOFF.md            # This file
├── CLAUDE.md             # Agent contract (thin pointer to main)
└── pubspec.yaml          # Dependencies and config
```

### Key Design Decisions
- **Transport**: LAN-first, peer-to-peer, with length-prefixed TCP framing
- **Security**: RSA-2048 device keys + Ed25519 roster signatures + encrypted LAN channel
- **UI Framework**: Full Cupertino (Apple native design, no Material)
- **State Management**: Provider pattern with ChangeNotifier
- **Navigation**: GoRouter with 11-state state machine
- **Logging**: SecureLogging utility prevents data leakage

See `CLAUDE.md` for the multi-agent operating contract.
See `main` branch `docs/` for full specifications and architecture.

## Next Steps (Prioritized)

### CRITICAL - Security/Encryption (2-3 hours)
1. Integrate dart_ed25519 package for Ed25519 verification
2. Fetch control plane public keys from backend
3. Enable production Ed25519 signature verification
4. Implement RSA message encryption in TransportEncryption
5. Test against invalid contract vectors (`contracts/vectors/invalid/`)

### IMPORTANT - Integration & Testing (3-4 hours)
1. End-to-end device testing (iOS simulator + Android emulator)
2. Test clipboard sync across two simulated devices
3. Verify no clipboard data in logs/telemetry
4. Test rejection of malformed events (oversized, bad hash, etc.)
5. Test deduplication prevents echo loops

### Testing Strategy
- Unit tests: ClipboardEvent validation, hash computation
- Integration tests: Auth flow, peer discovery, clipboard events
- Contract conformance: All valid vectors must pass, all invalid vectors must fail
- Security: Replay prevention, oversized payload rejection, malformed message handling

## Known Issues / Technical Debt

1. **Ed25519 verification** - Currently a stub that gracefully degrades
   - Waiting for dart_ed25519 package availability
   - Control plane keys not yet available from backend
   - Path forward: implement with real Ed25519 library when available

2. **RSA encryption** - Stubs in TransportEncryption class
   - Plaintext messages currently sent over LAN
   - Critical for production: needs RSA-2048 with proper OAEP padding
   - Can use pointycastle once Ed25519 dependency resolved

3. **Platform limitations**
   - iOS: Clipboard monitoring limited by OS backgrounding rules
   - Android: Doze mode / Battery Saver may impact background sync
   - Design accounts for this (user-triggered share extension preferred)

4. **Documentation gaps** (per SPEC_CONTRACT.md §20)
   - Gap 1: Resolved — contracts now on main
   - Gap 4: Peer roster distribution — Ed25519 verification framework in place
   - Gap 5: Pairing protocol — Device registration working via API
   - Gap 6: Authentication mechanism — Tokens working, needs formalization
   - Gap 7: Size limits — Implemented in code, spec formalization pending
   - Gap 8: API versioning — Not yet implemented

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
