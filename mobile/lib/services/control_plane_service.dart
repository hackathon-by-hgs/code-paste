import '../utils/secure_logging.dart';
import 'api_client.dart';
import 'peer_discovery_service.dart';

/// Service for managing control plane keys and configuration
///
/// This service fetches Ed25519 public keys from the control plane API
/// that are used to verify peer roster signatures.
///
/// Usage:
/// ```dart
/// final cpService = ControlPlaneService(
///   apiClient: apiClient,
///   peerDiscovery: peerDiscoveryService,
/// );
/// await cpService.fetchAndRegisterKeys();
/// ```
class ControlPlaneService {
  final ApiClient _apiClient;
  final PeerDiscoveryService _peerDiscovery;

  ControlPlaneService({
    required ApiClient apiClient,
    required PeerDiscoveryService peerDiscovery,
  }) : _apiClient = apiClient,
       _peerDiscovery = peerDiscovery;

  /// Fetch and register control plane signing keys
  /// This should be called after authentication to enable roster signature verification
  Future<void> fetchAndRegisterKeys() async {
    try {
      SecureLogging.logSyncEvent('Fetching control plane signing keys');

      // Fetch keys from backend
      // TODO: Replace this endpoint with the actual backend endpoint when available
      // Expected response format:
      // {
      //   "keys": [
      //     {
      //       "keyId": "control-plane-key-1",
      //       "publicKey": "base64-encoded-ed25519-public-key",
      //       "algorithm": "Ed25519",
      //       "createdAt": "2026-09-08T00:00:00Z",
      //       "expiresAt": "2027-09-08T00:00:00Z"
      //     }
      //   ]
      // }

      final response = await _apiClient.get('/authz/keys', withAuth: true);

      final keys = response['keys'] as List<dynamic>?;
      if (keys == null) {
        SecureLogging.logSecurity(
          'invalid_keys_response',
          'No keys in response',
        );
        return;
      }

      int registeredCount = 0;
      for (final keyData in keys) {
        try {
          final keyId = keyData['keyId'] as String?;
          final publicKey = keyData['publicKey'] as String?;
          final algorithm = keyData['algorithm'] as String?;

          if (keyId == null || publicKey == null) {
            SecureLogging.logSecurity(
              'incomplete_key',
              'Missing keyId or publicKey',
            );
            continue;
          }

          if (algorithm != 'Ed25519') {
            SecureLogging.logSecurity(
              'unsupported_algorithm',
              'Algorithm: $algorithm (only Ed25519 supported)',
            );
            continue;
          }

          // Register the key
          _peerDiscovery.registerControlPlaneKey(keyId, publicKey);
          registeredCount++;
        } catch (e) {
          SecureLogging.logError('register_key', e as Exception);
        }
      }

      SecureLogging.logSyncEvent(
        'Registered $registeredCount control plane keys',
      );
    } catch (e) {
      SecureLogging.logSecurity('fetch_keys_failed', e.toString());
      rethrow;
    }
  }

  /// Enable strict signature verification
  /// When enabled, roster signatures must verify or roster load will fail
  /// Disabled by default for development
  void enableStrictVerification() {
    _peerDiscovery.setStrictVerification(true);
    SecureLogging.logSecurity(
      'strict_verification_enabled',
      'Signature verification is now mandatory',
    );
  }

  /// Disable strict verification (development mode)
  void disableStrictVerification() {
    _peerDiscovery.setStrictVerification(false);
    SecureLogging.logSyncEvent(
      'Strict verification disabled (development mode)',
    );
  }
}

/// Model for control plane key response
class ControlPlaneKey {
  final String keyId;
  final String publicKey;
  final String algorithm;
  final DateTime createdAt;
  final DateTime? expiresAt;

  ControlPlaneKey({
    required this.keyId,
    required this.publicKey,
    required this.algorithm,
    required this.createdAt,
    this.expiresAt,
  });

  factory ControlPlaneKey.fromJson(Map<String, dynamic> json) {
    return ControlPlaneKey(
      keyId: json['keyId'] as String,
      publicKey: json['publicKey'] as String,
      algorithm: json['algorithm'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : null,
    );
  }

  bool get isExpired => expiresAt != null && DateTime.now().isAfter(expiresAt!);

  Map<String, dynamic> toJson() => {
    'keyId': keyId,
    'publicKey': publicKey,
    'algorithm': algorithm,
    'createdAt': createdAt.toIso8601String(),
    'expiresAt': expiresAt?.toIso8601String(),
  };
}
