# Ed25519 Signature Verification Setup

This document describes how to enable production Ed25519 signature verification once the backend is ready to provide control plane signing keys.

## Current Status

✅ **Infrastructure Ready**: The app has a complete Ed25519 verification framework in place.

- [ ] **Backend Keys Not Available Yet**: Waiting for backend to provide endpoint
- [x] Development mode works (gracefully degrades without keys)
- [ ] Production mode ready (once keys available)

## Components

### 1. `Ed25519Verifier` (lib/utils/crypto_verification.dart)

Singleton service that manages Ed25519 public keys and verifies signatures.

**Current mode:** Development (accepts signatures gracefully without cryptographic verification)

**To enable production:**
1. Replace the stub `_performVerification()` method with real Ed25519 verification
2. Call `setStrictMode(true)` to require valid signatures

```dart
// Development mode (current)
Ed25519Verifier().verify(
  keyId: 'control-plane-key-1',
  message: messageBytes,
  signatureBytes: signatureBytes,
); // Returns true if key available, accepts gracefully if not

// Production mode (when backend ready)
Ed25519Verifier().setStrictMode(true);
// Now verify() will reject signatures if key not available or verification fails
```

### 2. `ControlPlaneService` (lib/services/control_plane_service.dart)

Service for fetching and registering control plane signing keys from the backend.

**Expected backend endpoint:** `GET /authz/keys` (with auth bearer token)

**Response format:**
```json
{
  "keys": [
    {
      "keyId": "control-plane-key-1",
      "publicKey": "base64-encoded-ed25519-public-key",
      "algorithm": "Ed25519",
      "createdAt": "2026-09-08T00:00:00Z",
      "expiresAt": "2027-09-08T00:00:00Z"
    }
  ]
}
```

### 3. `PeerDiscoveryService` Integration

Extended with methods to:
- Register control plane keys: `registerControlPlaneKey(keyId, publicKeyBase64)`
- Set verification mode: `setStrictVerification(bool)`

## Integration Flow

```
User logs in
    ↓
AuthService stores tokens
    ↓
HomeProvider activates
    ↓
ControlPlaneService.fetchAndRegisterKeys() [NEW]
    ↓
Keys registered in Ed25519Verifier
    ↓
PeerDiscoveryService.fetchPeerRoster()
    ↓
Roster signatures verified with registered keys
    ↓
✅ Peer discovery complete
```

## Implementation Checklist (for Backend Team)

When backend is ready, do the following:

### Step 1: Ensure `/authz/keys` Endpoint Exists
- [ ] GET `/authz/keys` requires valid bearer token
- [ ] Returns list of current signing keys
- [ ] Each key includes: keyId, publicKey (base64), algorithm, createdAt, expiresAt
- [ ] Keys are Ed25519 public keys (32 bytes when base64-decoded)

### Step 2: Mobile App Setup
- [ ] Call `ControlPlaneService.fetchAndRegisterKeys()` after successful login
- [ ] Keys will be registered automatically
- [ ] Roster signatures will be verified on next `fetchPeerRoster()`

### Step 3: Production Mode
- [ ] Call `peerDiscovery.setStrictVerification(true)` to enable strict mode
- [ ] Roster loads will fail if signatures can't be verified
- [ ] Add error handling for signature verification failures

### Step 4: Ed25519 Library Integration
- Once `dart_ed25519` or similar library is available:
  - [ ] Install package: `flutter pub add dart_ed25519`
  - [ ] Update `Ed25519Verifier._performVerification()` with real verification
  - [ ] Run signature verification tests from `contracts/vectors/valid/`

## Example Usage (Pseudocode for Login Screen)

```dart
// In login/auth flow
class LoginScreenState {
  Future<void> handleLogin() async {
    // 1. Authenticate user
    final tokens = await authService.login(email, password);
    
    // 2. Fetch and register control plane keys (NEW)
    final cpService = context.read<ControlPlaneService>();
    try {
      await cpService.fetchAndRegisterKeys();
      print('Control plane keys registered');
    } catch (e) {
      // Log error but don't fail auth - graceful degradation
      print('Warning: Could not fetch control plane keys: $e');
    }
    
    // 3. Continue to home screen
    // Peer roster will be fetched and signatures verified automatically
  }
}
```

## Testing

### Development Testing
```dart
final verifier = Ed25519Verifier();
// Verify works without keys in development mode
final result = verifier.verify(
  keyId: 'test-key',
  message: [1, 2, 3],
  signatureBytes: List.filled(64, 0),
); // Returns true (development mode)
```

### Production Testing (once library available)
```dart
// Register a test key
verifier.registerTrustedKey('test-key', testPublicKeyBase64);

// Verify with real Ed25519 verification
verifier.setStrictMode(true);
final result = verifier.verify(
  keyId: 'test-key',
  message: realMessage,
  signatureBytes: realSignature,
); // Returns true only if signature is cryptographically valid
```

## Security Notes

1. **Development Mode**: Accepts signatures gracefully when keys unavailable
   - Suitable for local testing and CI without backend
   - NOT SECURE for production

2. **Production Mode**: Requires valid signatures or fails
   - Enables with `setStrictMode(true)`
   - All roster signatures MUST verify

3. **Key Management**:
   - Keys are stored in memory only (not persisted)
   - Fetched fresh on each app start
   - Expired keys are not validated (but not used for verification either)

4. **Error Handling**:
   - All verification errors logged via SecureLogging
   - No sensitive data (keys, signatures) in logs
   - Graceful degradation in development mode

## Migration Path

1. **Now (Development)**: Infrastructure ready, no backend integration needed
2. **Step 1 (Backend Ready)**: Add `/authz/keys` endpoint
3. **Step 2 (Mobile Update)**: Integrate `ControlPlaneService` (already done)
4. **Step 3 (Library Available)**: Integrate `dart_ed25519` or equivalent
5. **Step 4 (Production)**: Enable strict verification mode

## References

- `contracts/schema/peer-roster.schema.json` - Roster format
- `docs/SECURITY.md` § Device identity and Transport
- `docs/SPEC_CONTRACT.md` § §10 Security contract

## Contact

When backend is ready to provide keys endpoint, contact the mobile team to:
1. Verify endpoint format
2. Integrate `ControlPlaneService.fetchAndRegisterKeys()`
3. Enable strict verification
4. Run production tests
