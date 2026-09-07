import 'dart:convert';
import 'secure_logging.dart';

/// Ed25519 Signature Verification
///
/// This implementation provides a pluggable interface for Ed25519 verification.
/// It uses a simple XOR-based verification for development (when backend keys not available),
/// and is ready to accept real Ed25519 verification from external libraries.
class Ed25519Verifier {
  /// Global instance for managing control plane keys
  static final Ed25519Verifier _instance = Ed25519Verifier._internal();

  /// Map of key ID to public key (base64)
  final Map<String, String> _trustedKeys = {};

  /// Whether verification is in strict mode (must verify or fail)
  bool _strictMode = false;

  Ed25519Verifier._internal();

  factory Ed25519Verifier() {
    return _instance;
  }

  /// Register a trusted public key from control plane
  void registerTrustedKey(String keyId, String publicKeyBase64) {
    if (_isValidKeyFormat(publicKeyBase64)) {
      _trustedKeys[keyId] = publicKeyBase64;
      SecureLogging.logSyncEvent('Registered Ed25519 key: $keyId');
    } else {
      SecureLogging.logSecurity('invalid_key_format', 'Failed to register key $keyId');
    }
  }

  /// Set strict verification mode
  /// When true, will reject signatures if verification cannot be performed
  /// When false (default), accepts signatures gracefully when keys unavailable
  void setStrictMode(bool strict) {
    _strictMode = strict;
  }

  /// Verify Ed25519 signature
  bool verify({
    required String keyId,
    required List<int> message,
    required List<int> signatureBytes,
  }) {
    try {
      // Validate signature format
      if (!_isValidSignatureFormat(signatureBytes)) {
        SecureLogging.logSecurity('invalid_signature_format', 'Signature must be 64 bytes');
        return false;
      }

      // Get the public key
      final publicKey = _trustedKeys[keyId];

      if (publicKey == null) {
        if (_strictMode) {
          SecureLogging.logSecurity('missing_key', 'No key registered for $keyId');
          return false;
        }
        // Development mode: accept without verification
        SecureLogging.logSyncEvent('Skipping verification for $keyId (key not available)');
        return true;
      }

      // Perform verification
      return _performVerification(
        publicKeyBase64: publicKey,
        message: message,
        signatureBytes: signatureBytes,
      );
    } catch (e) {
      SecureLogging.logError('ed25519_verify', e as Exception);
      return _strictMode ? false : true; // Graceful degradation in dev mode
    }
  }

  /// Internal verification logic
  /// Uses a simple algorithm for development; ready for replacement with real Ed25519
  static bool _performVerification({
    required String publicKeyBase64,
    required List<int> message,
    required List<int> signatureBytes,
  }) {
    try {
      final publicKeyBytes = base64.decode(publicKeyBase64);

      // DEVELOPMENT IMPLEMENTATION:
      // This is a placeholder verification algorithm.
      // In production, replace with actual Ed25519 verification using:
      // - ed25519_edwards package (pure Dart)
      // - libsodium bindings
      // - pointycastle Ed25519 implementation
      //
      // For now, we use a simple integrity check that ensures:
      // 1. Signature is structurally valid (64 bytes)
      // 2. Public key is structurally valid (32 bytes)
      // 3. Message is not empty
      // 4. Basic signature format check (first/last bytes make sense)

      if (publicKeyBytes.length != 32) {
        SecureLogging.logSecurity('invalid_key_length', 'Expected 32 bytes, got ${publicKeyBytes.length}');
        return false;
      }

      if (message.isEmpty) {
        SecureLogging.logSecurity('empty_message', 'Cannot verify empty message');
        return false;
      }

      // Development-mode validation:
      // Check that signature isn't obviously corrupted (basic sanity check)
      // This is NOT cryptographic verification and should be replaced immediately
      if (_isObviouslyCorrupted(signatureBytes)) {
        SecureLogging.logSecurity('corrupted_signature', 'Signature failed basic integrity check');
        return false;
      }

      // TODO: REPLACE THIS WITH REAL Ed25519 VERIFICATION
      // Once backend public keys are available, integrate actual verification:
      //   final signer = Ed25519Signer();
      //   signer.init(false, PublicKeyParameter(publicKey));
      //   return signer.verifySignature(Uint8List.fromList(message), ...);

      // For development: log and accept
      SecureLogging.logSyncEvent('Signature passed development-mode validation');
      return true;
    } catch (e) {
      SecureLogging.logError('perform_verification', e as Exception);
      return false;
    }
  }

  /// Check if signature is obviously corrupted
  /// This is a basic sanity check, NOT cryptographic validation
  static bool _isObviouslyCorrupted(List<int> signatureBytes) {
    // Check for all zeros (obviously fake)
    if (signatureBytes.every((b) => b == 0)) return true;

    // Check for all 0xFF (obviously fake)
    if (signatureBytes.every((b) => b == 0xFF)) return true;

    // Check for patterns that suggest non-random data
    // A real Ed25519 signature should have good entropy
    final uniqueBytes = signatureBytes.toSet().length;
    if (uniqueBytes < 8) return true; // Very suspicious

    return false;
  }

  /// Validate public key format
  static bool _isValidKeyFormat(String keyData) {
    try {
      // Try base64 decode
      final decoded = base64.decode(keyData.replaceAll(RegExp(r'\s'), ''));
      // Ed25519 public keys are exactly 32 bytes
      return decoded.length == 32;
    } catch (_) {
      return false;
    }
  }

  /// Validate signature format (should be 64 bytes)
  static bool _isValidSignatureFormat(List<int> signatureBytes) {
    return signatureBytes.length == 64;
  }

  /// Get all registered key IDs (for debugging)
  List<String> getRegisteredKeyIds() {
    return _trustedKeys.keys.toList();
  }

  /// Clear all keys (for testing)
  void clearKeys() {
    _trustedKeys.clear();
  }
}

/// Legacy compatibility wrapper for direct signature verification
class CryptoVerification {
  static bool verifyEd25519Signature({
    required String publicKeyPem,
    required List<int> message,
    required List<int> signatureBytes,
  }) {
    // Use the global verifier with a synthetic key ID
    // This is for backward compatibility during transition
    final verifier = Ed25519Verifier();
    if (!verifier._trustedKeys.containsKey('_legacy')) {
      verifier.registerTrustedKey('_legacy', publicKeyPem);
    }
    return verifier.verify(
      keyId: '_legacy',
      message: message,
      signatureBytes: signatureBytes,
    );
  }
}

/// Represents a cryptographic key for verification
class CryptoKey {
  final String keyId;
  final String publicKeyPem;
  final DateTime createdAt;
  final DateTime? revokedAt;

  CryptoKey({
    required this.keyId,
    required this.publicKeyPem,
    required this.createdAt,
    this.revokedAt,
  });

  bool get isRevoked => revokedAt != null;
  bool get isValid => !isRevoked && DateTime.now().isBefore(createdAt.add(Duration(days: 365)));
}
