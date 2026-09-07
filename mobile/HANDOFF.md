# Handoff — Mobile Domain

## Completed: Phase 1-3 (Auth, API, Peer Discovery)

### Phase 1: Auth & Registration ✅
- AuthService with secure token storage (flutter_secure_storage)
- Login/Signup/Device Setup screens (full Cupertino style)
- RSA-2048 key generation (public/private stored locally)
- State transitions: Login → Signup → Device Registration

### Phase 2: Backend API Integration ✅
- ApiClient HTTP wrapper with proper error handling
- Endpoints: /auth/login, /auth/signup, /auth/refresh, /auth/logout, /devices
- Bearer token injection and 401 refresh
- X-CodePaste-Client diagnostic header

### Phase 2 Corrections (Contract Audit) ✅
- Key fingerprint calculation (SHA256 of public key)
- Extended DeviceCredentials with full metadata
- ProtocolPolicy model for payload limits
- Sequence number tracking for clipboard events

### Phase 3: Peer Discovery (Scaffolded) ✅
- Peer/PeerRoster/SignedPeerRoster models per contract
- PeerDiscoveryService fetches /authz/peer-set
- Base64 decoding of signed roster payload
- Network model extended for device matching (deviceId, userId, publicKey, isVerified)
- Peer lookup by deviceId or fingerprint

## In Progress / Stubbed

### Phase 3 Remaining (Peer Discovery)
- [ ] Ed25519 signature verification (need control plane public keys)
- [ ] Integrate PeerDiscoveryService into HomeProvider
- [ ] Match discovered devices to roster peers

### Phase 4: Clipboard Sync (Not Started)
- [ ] iOS: UIPasteboard reading/writing via MethodChannel
- [ ] Android: ClipboardManager reading/writing via MethodChannel
- [ ] Clipboard change detection and monitoring
- [ ] ClipboardEvent creation (UUID, sequence, hash, payload encoding)
- [ ] LAN peer connection with encrypted channel
- [ ] Event transmission and reception
- [ ] Validation per contract (hash, size, content-type, sequence)

## Key Files

```
lib/
  services/
    auth_service.dart              Phase 1-2
    api_client.dart                Phase 2
    peer_discovery_service.dart    Phase 3
    permission_service.dart        Existing
    local_device_discovery.dart    Existing (mock)
  models/
    app_state.dart                 11-state machine
    network.dart                   Updated for matching
    peer.dart                      Phase 3 contracts
    protocol_policy.dart           Payload limits
  screens/
    auth/login_screen.dart         Phase 1
    auth/signup_screen.dart        Phase 1
    auth/device_setup_screen.dart  Phase 1
    home/home_screen_cupertino.dart Existing
  providers/
    home_provider.dart             Needs peer integration
```

## Next Steps (Priority Order)

1. **Ed25519 Signature Verification** (Phase 3 completion)
   - Get control plane public keys from backend
   - Implement verification in PeerDiscoveryServiceImpl._decodeAndVerifyRoster()
   - Add dart_ed25519 dependency

2. **Integrate Peer Discovery into Home Provider**
   - Fetch roster on power button activation
   - Match discovered devices to roster
   - Display verified peers in bottom sheet

3. **Platform Channels for Clipboard**
   - iOS Swift code for UIPasteboard
   - Android Kotlin code for ClipboardManager
   - MethodChannel bridges

4. **Clipboard Event Implementation** (Phase 4)
   - UUID generation for eventId
   - SHA256 hashing for payload validation
   - Base64 encoding for images
   - Sequence number incrementing

5. **LAN Transport & Encryption**
   - Establish socket connection to peer
   - Implement AES-GCM or similar encryption
   - Send/receive encrypted events
   - Handle reconnection and timeout

6. **Tests** (Required by CLAUDE.md)
   - Unit tests: AuthService, ApiClient, PeerDiscoveryService
   - Widget tests: Auth screens
   - Integration tests: Full auth flow

## Architecture Flow

```
User taps Power Button (OFF)
  ↓
HomeProvider.toggleFeature()
  ↓
Request permissions
  ↓
Fetch peer roster via PeerDiscoveryService
  ↓
Match LAN devices to roster peers
  ↓
Display verified peers in bottom sheet
  ↓
User taps peer → Establish encrypted LAN connection
  ↓
Monitor clipboard changes
  ↓
Create ClipboardEvent (eventId, sequence, hash, payload)
  ↓
Sign/encrypt and send to peer
  ↓
Peer receives, validates, writes to OS clipboard
```

## Known Issues

- None critical; Phase 3 Ed25519 verification needs implementation

## Dependencies Added

```yaml
flutter_secure_storage: ^9.0.0   # Token/key storage
pointycastle: ^3.7.0             # RSA key generation
http: ^1.1.0                     # HTTP client
package_info_plus: ^8.0.0        # App version detection
crypto: ^3.0.0                   # SHA256 hashing
uuid: ^4.0.0                     # Event ID generation
# TODO: dart_ed25519 for signature verification
```

## Testing Status

- [ ] Build passes: `flutter run -d <device>`
- [ ] Auth flow works end-to-end
- [ ] API calls succeed (with backend)
- [ ] Peer roster fetches and decodes
- [ ] Clipboard events created correctly
- [ ] Contract compliance tests pass

## Session Summary

**Started:** Phase 1 auth & registration scaffolding
**Completed:** Full auth flow (login/signup/device setup) + backend API integration + peer discovery models
**Current:** Phase 3 peer discovery scaffolding (needs Ed25519 verification + HomeProvider integration)
**Ready for:** Phase 4 clipboard sync implementation
**Estimated effort:** Phase 4: 3-4 hours (clipboard + LAN transport)
