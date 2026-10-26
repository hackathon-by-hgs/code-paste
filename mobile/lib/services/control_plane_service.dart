import '../utils/secure_logging.dart';
import 'api_client.dart';
import 'peer_discovery_service.dart';

/// Loads the control plane's roster signing keys.
///
/// Without at least one of these keys no roster can be verified, and an
/// unverified roster authorizes nothing — so this must succeed before clipboard
/// sync is allowed to start.
class ControlPlaneService {
  /// `GET /v1/authz/roster-keys` is deliberately unauthenticated so an agent can
  /// verify a cached roster even while it cannot authenticate. It returns public
  /// keys only, so the device token is not sent with it.
  static const String rosterKeysPath = '/authz/roster-keys';

  /// v1 pins the algorithm to this exact lowercase value.
  static const String expectedAlgorithm = 'ed25519';

  final ApiClient _apiClient;
  final PeerDiscoveryService _peerDiscovery;

  ControlPlaneService({
    required ApiClient apiClient,
    required PeerDiscoveryService peerDiscovery,
  }) : _apiClient = apiClient,
       _peerDiscovery = peerDiscovery;

  /// Fetches the roster signing keys and registers them for verification.
  ///
  /// Returns the number of keys registered. Throws [StateError] if none could
  /// be registered: carrying on would leave every roster unverifiable, and the
  /// caller needs to know that rather than discover it as "no peers".
  Future<int> fetchAndRegisterKeys() async {
    final response = await _apiClient.get(rosterKeysPath, withAuth: false);

    final keys = response['keys'];
    if (keys is! List) {
      throw StateError('roster-keys response has no key list');
    }

    var registered = 0;
    for (final entry in keys) {
      if (entry is! Map) continue;

      final keyId = entry['keyId'];
      final publicKey = entry['publicKey'];
      final algorithm = entry['algorithm'];

      if (algorithm != expectedAlgorithm) {
        SecureLogging.logSecurity(
          'roster_key_unsupported_algorithm',
          'algorithm=$algorithm',
        );
        continue;
      }
      if (keyId is! String || publicKey is! String) {
        SecureLogging.logSecurity('roster_key_incomplete', 'missing field');
        continue;
      }

      if (_peerDiscovery.registerControlPlaneKey(keyId, publicKey)) {
        registered++;
      }
    }

    if (registered == 0) {
      throw StateError('no usable roster signing keys were returned');
    }

    SecureLogging.logSyncEvent('Registered $registered roster signing keys');
    return registered;
  }
}
