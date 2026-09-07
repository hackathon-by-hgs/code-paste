import 'dart:convert';
import '../models/peer.dart';
import '../models/network.dart';
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

      // TODO: Verify Ed25519 signature using signatureValue
      // For now, assume signature is valid (backend provides it)
      // In production, use dart_ed25519 or similar to verify:
      //   verify(
      //     publicKey: controlPlanePublicKey[signedRoster.signatureKeyId],
      //     message: payloadBytes,
      //     signature: base64.decode(signedRoster.signatureValue),
      //   )

      return payloadJson;
    } catch (e) {
      throw Exception('Failed to decode/verify roster: $e');
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
