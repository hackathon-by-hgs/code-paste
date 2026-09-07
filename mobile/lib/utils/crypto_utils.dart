import 'package:crypto/crypto.dart';
import 'dart:convert';

class CryptoUtils {
  /// Calculate SHA256 fingerprint of a public key (hex encoded)
  static String calculateKeyFingerprint(String publicKeyPem) {
    final bytes = utf8.encode(publicKeyPem);
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  /// Calculate SHA256 hash of payload (for clipboard events)
  static String calculatePayloadHash(String payload) {
    final bytes = utf8.encode(payload);
    final digest = sha256.convert(bytes);
    return 'sha256:${digest.toString()}';
  }

  /// Calculate SHA256 hash of binary data (for images)
  static String calculateBinaryHash(List<int> data) {
    final digest = sha256.convert(data);
    return 'sha256:${digest.toString()}';
  }

  /// Verify a hash matches payload
  static bool verifyHash(String payload, String expectedHash) {
    final calculated = calculatePayloadHash(payload);
    return calculated == expectedHash;
  }
}
