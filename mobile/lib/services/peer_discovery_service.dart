import 'dart:convert';
import '../models/peer.dart';
import '../models/network.dart';
import '../utils/crypto_verification.dart';
import '../utils/secure_logging.dart';
import 'api_client.dart';

abstract class PeerDiscoveryService {
  Future<PeerRoster> fetchPeerRoster();
  Future<void> refreshPeerRoster();
  Peer? findPeerByDeviceId(String deviceId);
  Peer? findPeerByFingerprint(String fingerprint);
  List<Peer> getAvailablePeers();
  bool isRosterValid();
}

class PeerDiscoveryServiceImpl implements PeerDiscoveryService {
  final ApiClient _apiClient;
  PeerRoster? _cachedRoster;

  // Control plane public keys for signature verification
  // In production, these would be fetched from a secure source
  static const Map<String, String> _controlPlaneKeys = {
    // 'key-id-1': 'base64-encoded-ed25519-public-key',
  };

  PeerDiscoveryServiceImpl({required ApiClient apiClient})
    : _apiClient = apiClient;

  @override
  Future<PeerRoster> fetchPeerRoster() async {
    try {
      final response = await _apiClient.get('/authz/peer-set', withAuth: true);

      // Parse SignedPeerRoster
      final signedRoster = SignedPeerRoster.fromJson(response);

      // Decode and verify
      final rosterJson = _decodeAndVerifyRoster(signedRoster);

      // Parse PeerRoster from verified JSON
      _cachedRoster = PeerRoster.fromJson(rosterJson);
      return _cachedRoster!;
    } catch (e) {
      throw Exception('Failed to fetch peer roster: $e');
    }
  }

  @override
  Future<void> refreshPeerRoster() async {
    await fetchPeerRoster();
  }

  @override
  Peer? findPeerByDeviceId(String deviceId) {
    return _cachedRoster?.findPeerByDeviceId(deviceId);
  }

  @override
  Peer? findPeerByFingerprint(String fingerprint) {
    return _cachedRoster?.findPeerByFingerprint(fingerprint);
  }

  @override
  List<Peer> getAvailablePeers() {
    if (_cachedRoster == null || _cachedRoster!.isExpired()) {
      return [];
    }
    return _cachedRoster!.peers;
  }

  @override
  bool isRosterValid() {
    return _cachedRoster != null && !_cachedRoster!.isExpired();
  }

  Map<String, dynamic> _decodeAndVerifyRoster(SignedPeerRoster signedRoster) {
    try {
      // Decode base64 payload
      final payloadBytes = base64.decode(signedRoster.payload);
      final payloadJson =
          jsonDecode(utf8.decode(payloadBytes)) as Map<String, dynamic>;

      // Attempt Ed25519 signature verification
      _verifyRosterSignature(signedRoster, payloadBytes);

      return payloadJson;
    } catch (e) {
      SecureLogging.logSecurity('roster_decode_failed', e.toString());
      throw Exception('Failed to decode/verify roster: $e');
    }
  }

  /// Verify Ed25519 signature of the peer roster
  void _verifyRosterSignature(SignedPeerRoster signedRoster, List<int> payloadBytes) {
    // Get the public key for verification
    final publicKey = _controlPlaneKeys[signedRoster.signatureKeyId];

    if (publicKey == null) {
      // Public keys not configured yet - log and continue
      // In production, this would be a verification failure
      SecureLogging.logSecurity('no_signing_key', 'Missing public key: ${signedRoster.signatureKeyId}');
      return;
    }

    try {
      // Decode signature from base64
      final signatureBytes = base64.decode(signedRoster.signatureValue);

      // Verify signature using Ed25519
      final isValid = CryptoVerification.verifyEd25519Signature(
        publicKeyPem: publicKey,
        message: payloadBytes,
        signatureBytes: signatureBytes,
      );

      if (!isValid) {
        SecureLogging.logSecurity('roster_verification_failed', 'Invalid Ed25519 signature');
        throw Exception('Peer roster signature verification failed');
      }

      SecureLogging.logSyncEvent('Peer roster signature verified');
    } catch (e) {
      SecureLogging.logSecurity('roster_verification_error', e.toString());
      rethrow;
    }
  }

  /// Match a Network (LAN-discovered) to a Peer (from roster)
  /// Returns the matching Peer if fingerprints match
  Peer? matchNetworkToPeer(Network network) {
    if (_cachedRoster == null || _cachedRoster!.isExpired()) {
      return null;
    }

    // Try to find peer by device ID if available
    if (network.deviceId != null) {
      final peer = _cachedRoster!.findPeerByDeviceId(network.deviceId!);
      if (peer != null) return peer;
    }

    // Could also match by fingerprint if we have it
    // For now, just by name/IP matching in home provider

    return null;
  }
}
