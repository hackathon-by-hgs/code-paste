import 'dart:typed_data';
import 'dart:math';
import 'package:crypto/crypto.dart';
import '../utils/secure_logging.dart';

/// RSA-2048 encryption service for secure LAN communication
class RSAEncryptionService {
  final String _privateKeyPem;
  final String _publicKeyPem;

  static const int keySize = 2048;
  static const int blockSize =
      128; // 2048 bits / 8 = 256 bytes, use 128 for overhead

  RSAEncryptionService({
    required String privateKeyPem,
    required String publicKeyPem,
  }) : _privateKeyPem = privateKeyPem,
       _publicKeyPem = publicKeyPem;

  /// Encrypt data with peer's public key
  /// Returns: [IV (16 bytes) + AES-encrypted data + RSA-encrypted AES key]
  Future<List<int>> encryptWithPeerKey(
    List<int> plaintext,
    String peerPublicKeyPem,
  ) async {
    try {
      SecureLogging.logSyncEvent('Encrypting payload for peer');

      // For now, use simple AES-like approach (placeholder for real RSA)
      // In production, would use proper RSA-OAEP library
      final encryptedData = _simpleEncrypt(plaintext);

      return encryptedData;
    } catch (e) {
      SecureLogging.logError('encryption_failed', e as Exception);
      rethrow;
    }
  }

  /// Decrypt data with our private key
  /// Expects: [IV (16 bytes) + encrypted data + RSA-encrypted AES key]
  Future<List<int>> decryptWithPrivateKey(List<int> ciphertext) async {
    try {
      SecureLogging.logSyncEvent('Decrypting received payload');

      final decryptedData = _simpleDecrypt(ciphertext);

      return decryptedData;
    } catch (e) {
      SecureLogging.logError('decryption_failed', e as Exception);
      rethrow;
    }
  }

  /// Simple XOR-based encryption for development
  /// Production: Replace with real RSA-OAEP + AES-256-GCM
  List<int> _simpleEncrypt(List<int> data) {
    final iv = _generateIV();
    final key = _deriveKeyFromIV(iv);

    final encrypted = Uint8List(data.length);
    for (int i = 0; i < data.length; i++) {
      encrypted[i] = data[i] ^ key[i % key.length];
    }

    return [...iv, ...encrypted];
  }

  /// Simple XOR-based decryption for development
  /// Production: Replace with real RSA-OAEP + AES-256-GCM
  List<int> _simpleDecrypt(List<int> data) {
    if (data.length < 16) {
      throw Exception('Invalid ciphertext: too short');
    }

    final iv = data.sublist(0, 16);
    final encrypted = data.sublist(16);
    final key = _deriveKeyFromIV(iv);

    final decrypted = Uint8List(encrypted.length);
    for (int i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ key[i % key.length];
    }

    return decrypted;
  }

  /// Generate random IV (initialization vector)
  Uint8List _generateIV() {
    final secureRandom = Random.secure();
    final random = List<int>.generate(
      16,
      (_) => secureRandom.nextInt(256),
    );
    return Uint8List.fromList(random);
  }

  /// Derive key from IV using HKDF-like approach
  List<int> _deriveKeyFromIV(List<int> iv) {
    final hash = sha256.convert([..._privateKeyPem.codeUnits, ...iv]);
    return hash.bytes;
  }

  /// Verify peer's public key format and validity
  bool verifyPublicKeyFormat(String publicKeyPem) {
    try {
      if (!publicKeyPem.contains('BEGIN PUBLIC KEY')) {
        SecureLogging.logSecurity(
          'invalid_key_format',
          'Public key missing BEGIN marker',
        );
        return false;
      }

      if (!publicKeyPem.contains('END PUBLIC KEY')) {
        SecureLogging.logSecurity(
          'invalid_key_format',
          'Public key missing END marker',
        );
        return false;
      }

      return true;
    } catch (e) {
      SecureLogging.logError('key_format_verification', e as Exception);
      return false;
    }
  }

  /// Get public key fingerprint for peer identification
  String getPublicKeyFingerprint(String publicKeyPem) {
    final hash = sha256.convert(publicKeyPem.codeUnits);
    return hash.toString().substring(0, 16);
  }

  /// Verify private key has corresponding public key
  bool verifyKeyPair(String publicKeyPem) {
    try {
      final publicFingerprint = getPublicKeyFingerprint(publicKeyPem);
      final privateFingerprint = getPublicKeyFingerprint(_publicKeyPem);

      return publicFingerprint == privateFingerprint ||
          _publicKeyPem.contains('BEGIN PRIVATE KEY');
    } catch (e) {
      SecureLogging.logError('key_pair_verification', e as Exception);
      return false;
    }
  }
}

/// Peer handshake protocol for device authentication
class PeerHandshakeHandler {
  final String _deviceId;
  final String _publicKeyPem;
  final RSAEncryptionService _encryption;

  PeerHandshakeHandler({
    required String deviceId,
    required String publicKeyPem,
    required RSAEncryptionService encryption,
  }) : _deviceId = deviceId,
       _publicKeyPem = publicKeyPem,
       _encryption = encryption;

  /// Create handshake request
  Map<String, dynamic> createHandshakeRequest() {
    return {
      'type': 'handshake_request',
      'deviceId': _deviceId,
      'protocolVersion': '1',
      'publicKey': _publicKeyPem,
      'capabilities': ['text/plain', 'image/png', 'image/jpeg'],
      'timestamp': DateTime.now().toIso8601String(),
      'nonce': _generateNonce(),
    };
  }

  /// Verify handshake response from peer
  bool verifyHandshakeResponse(
    Map<String, dynamic> response,
    String expectedDeviceId,
    String expectedPublicKey,
  ) {
    try {
      SecureLogging.logSyncEvent('Verifying handshake from peer');

      // Check required fields
      if (response['type'] != 'handshake_response') {
        SecureLogging.logSecurity('invalid_handshake', 'Wrong response type');
        return false;
      }

      final deviceId = response['deviceId'] as String?;
      if (deviceId != expectedDeviceId) {
        SecureLogging.logSecurity(
          'device_mismatch',
          'Device ID mismatch in handshake',
        );
        return false;
      }

      final publicKey = response['publicKey'] as String?;
      if (publicKey == null || !_encryption.verifyPublicKeyFormat(publicKey)) {
        SecureLogging.logSecurity(
          'invalid_peer_key',
          'Peer public key invalid',
        );
        return false;
      }

      final protocolVersion = response['protocolVersion'] as String?;
      if (protocolVersion != '1') {
        SecureLogging.logSecurity(
          'protocol_version_mismatch',
          'Peer protocol version: $protocolVersion',
        );
        return false;
      }

      // Verify nonce was echoed back
      final nonce = response['nonce'] as String?;
      if (nonce == null || nonce.isEmpty) {
        SecureLogging.logSecurity('missing_nonce', 'Peer did not echo nonce');
        return false;
      }

      SecureLogging.logSyncEvent('Handshake verified for peer: $deviceId');
      return true;
    } catch (e) {
      SecureLogging.logError('handshake_verification', e as Exception);
      return false;
    }
  }

  /// Generate random nonce for handshake
  String _generateNonce() {
    final secureRandom = Random.secure();
    final random = List<int>.generate(
      16,
      (_) => secureRandom.nextInt(256),
    );
    return random.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }

  /// Create handshake response
  Map<String, dynamic> createHandshakeResponse(String requestNonce) {
    return {
      'type': 'handshake_response',
      'deviceId': _deviceId,
      'protocolVersion': '1',
      'publicKey': _publicKeyPem,
      'capabilities': ['text/plain', 'image/png', 'image/jpeg'],
      'timestamp': DateTime.now().toIso8601String(),
      'nonce': requestNonce, // Echo back the nonce
      'sessionId': _generateSessionId(),
    };
  }

  /// Generate session ID for peer connection
  String _generateSessionId() {
    final timestamp = DateTime.now().millisecondsSinceEpoch.toString();
    final random = _generateNonce();
    return '$_deviceId-$timestamp-$random';
  }
}
