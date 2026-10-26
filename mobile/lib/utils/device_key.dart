import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';

/// Device identity key helpers.
///
/// Every value here is defined by `device.schema.json`: a public key is 32 raw
/// Ed25519 bytes in standard base64, and a fingerprint is `sha256:` followed by
/// the lowercase hex digest **of those raw bytes** — not of a PEM wrapper, and
/// not of the base64 text. Fingerprints are what LAN discovery advertises and
/// what a roster lookup matches on, so hashing the wrong input makes a device
/// unrecognisable to every other implementation.
class DeviceKey {
  static const int keyLength = 32;

  static final RegExp publicKeyPattern = RegExp(r'^[A-Za-z0-9+/]{43}=$');

  /// `sha256:<hex>` over the raw 32 public-key bytes.
  static String fingerprintOfBytes(List<int> publicKeyBytes) {
    if (publicKeyBytes.length != keyLength) {
      throw ArgumentError('Ed25519 public key must be $keyLength bytes');
    }
    return 'sha256:${sha256.convert(publicKeyBytes)}';
  }

  /// `sha256:<hex>` for a base64-encoded public key.
  static String fingerprintOfBase64(String publicKeyBase64) =>
      fingerprintOfBytes(decodePublicKey(publicKeyBase64));

  /// Decodes a contract-shaped base64 public key.
  ///
  /// The pattern is checked before decoding because Dart's base64 decoder also
  /// accepts the URL-safe alphabet, and a key that decodes but is not the key
  /// the control plane published is a silent identity mismatch.
  static List<int> decodePublicKey(String publicKeyBase64) {
    if (!publicKeyPattern.hasMatch(publicKeyBase64)) {
      throw const FormatException('public key is not a base64 Ed25519 key');
    }
    final bytes = base64.decode(publicKeyBase64);
    if (bytes.length != keyLength) {
      throw const FormatException('public key is not 32 bytes');
    }
    return bytes;
  }

  /// Rebuilds the signing key pair from stored device credentials.
  ///
  /// The private half is the Ed25519 seed as produced by `extractPrivateKeyBytes`
  /// at registration, and it never leaves the device.
  static SimpleKeyPair keyPairFromStored({
    required String privateKeyBase64,
    required String publicKeyBase64,
  }) {
    final publicKeyBytes = decodePublicKey(publicKeyBase64);
    final privateKeyBytes = base64.decode(privateKeyBase64);
    if (privateKeyBytes.length != keyLength) {
      throw const FormatException('private key seed is not 32 bytes');
    }
    return SimpleKeyPairData(
      privateKeyBytes,
      publicKey: SimplePublicKey(publicKeyBytes, type: KeyPairType.ed25519),
      type: KeyPairType.ed25519,
    );
  }
}
