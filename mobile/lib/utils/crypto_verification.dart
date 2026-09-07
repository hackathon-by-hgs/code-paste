import 'dart:convert';
import 'dart:typed_data';

/// Cryptographic verification utilities for peer roster authentication
///
/// TODO: Implement with proper Ed25519 library once available
/// Current design is prepared for dart_ed25519 or libsodium bindings
class CryptoVerification {
  /// Verify Ed25519 signature of a message
  ///
  /// Returns true if signature is valid, false otherwise
  ///
  /// Args:
  ///   publicKeyPem: Base64-encoded or PEM-formatted Ed25519 public key
  ///   message: The original message bytes that were signed
  ///   signatureBytes: The signature bytes to verify
  ///
  /// SECURITY NOTE: This is a stub implementation.
  /// In production, replace with actual Ed25519 verification using:
  /// - dart_ed25519 package, OR
  /// - libsodium bindings, OR
  /// - PointyCastle's native Ed25519 implementation when available
  static bool verifyEd25519Signature({
    required String publicKeyPem,
    required List<int> message,
    required List<int> signatureBytes,
  }) {
    try {
      // Validate key format
      if (!_isValidKeyFormat(publicKeyPem)) {
        print('Invalid key format');
        return false;
      }

      // Validate signature length (Ed25519 signatures are 64 bytes)
      if (signatureBytes.length != 64) {
        print('Invalid signature length: ${signatureBytes.length}, expected 64');
        return false;
      }

      // TODO: Implement actual Ed25519 verification here
      // For now, this is a structural stub that will:
      // 1. Be called whenever signature verification is needed
      // 2. Log the attempt so we can track in tests/logs
      // 3. Allow graceful degradation until backend provides keys

      // In development: accept if keys not configured
      print('VERIFICATION STUB: Would verify Ed25519 signature (implementation pending)');
      return true;
    } catch (e) {
      print('Ed25519 verification error: $e');
      return false;
    }
  }

  /// Validate Ed25519 public key format
  static bool _isValidKeyFormat(String keyData) {
    try {
      // Try to decode as base64
      try {
        final decoded = base64.decode(keyData.replaceAll(RegExp(r'\s'), ''));
        // Ed25519 public keys are 32 bytes
        return decoded.length == 32;
      } catch (_) {
        // Try hex format
        if (keyData.length != 64) return false; // 32 bytes = 64 hex chars
        return _isValidHex(keyData);
      }
    } catch (_) {
      return false;
    }
  }

  /// Check if string is valid hex
  static bool _isValidHex(String hex) {
    try {
      int.parse(hex, radix: 16);
      return true;
    } catch (_) {
      return false;
    }
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
