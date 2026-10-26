import 'dart:convert';

import 'package:cryptography/cryptography.dart';

/// Verifies the control plane's Ed25519 signature over peer-roster bytes.
///
/// Fail-closed, with no development or degraded mode. ADR-003 makes the signed
/// roster the only thing standing between a peer discovered over mDNS and
/// clipboard data, so a verifier that accepts a signature it could not check
/// reduces authorization to "is on the same network" — the one inference this
/// product forbids outright.
class RosterSignatureVerifier {
  /// Raw Ed25519 key and signature sizes. Both are fixed in v1.
  static const int publicKeyLength = 32;
  static const int signatureLength = 64;

  /// The only algorithm v1 accepts. `peer-roster.schema.json` pins this to a
  /// constant so a signature cannot be downgraded to a weaker scheme.
  static const String algorithm = 'ed25519';

  /// Contract patterns, enforced rather than assumed.
  ///
  /// Dart's base64 decoder accepts both the standard and URL-safe alphabets and
  /// is forgiving about length. Matching the contract pattern first is what
  /// stops a malformed key from being adopted as a trusted identity — the same
  /// lenient-base64 trap the backend documented for Node.
  static final RegExp _publicKeyPattern = RegExp(r'^[A-Za-z0-9+/]{43}=$');
  static final RegExp _signaturePattern = RegExp(r'^[A-Za-z0-9+/]{86}==$');
  static final RegExp _keyIdPattern = RegExp(r'^cp_rk_[0-9a-hjkmnp-tv-z]{26}$');

  final Ed25519 _ed25519 = Ed25519();
  final Map<String, SimplePublicKey> _trustedKeys = <String, SimplePublicKey>{};

  /// Number of control-plane keys currently trusted.
  int get trustedKeyCount => _trustedKeys.length;

  /// Registers a roster signing key under its `keyId`, which is how the control
  /// plane rotates keys without breaking verifiers.
  ///
  /// Returns false and registers nothing when the key id or the key itself is
  /// not well formed.
  bool registerKey(String keyId, String publicKeyBase64) {
    if (!_keyIdPattern.hasMatch(keyId)) return false;
    if (!_publicKeyPattern.hasMatch(publicKeyBase64)) return false;

    final List<int> keyBytes;
    try {
      keyBytes = base64.decode(publicKeyBase64);
    } on FormatException {
      return false;
    }
    if (keyBytes.length != publicKeyLength) return false;

    _trustedKeys[keyId] = SimplePublicKey(keyBytes, type: KeyPairType.ed25519);
    return true;
  }

  void clearKeys() => _trustedKeys.clear();

  bool trusts(String keyId) => _trustedKeys.containsKey(keyId);

  /// True only when [signatureBase64] is a genuine Ed25519 signature, by the key
  /// registered under [keyId], over exactly [message].
  ///
  /// An unknown [keyId] is a rejection, not a reason to skip the check.
  Future<bool> verify({
    required String keyId,
    required String signatureBase64,
    required List<int> message,
  }) async {
    final publicKey = _trustedKeys[keyId];
    if (publicKey == null) return false;
    if (!_signaturePattern.hasMatch(signatureBase64)) return false;

    final List<int> signatureBytes;
    try {
      signatureBytes = base64.decode(signatureBase64);
    } on FormatException {
      return false;
    }
    if (signatureBytes.length != signatureLength) return false;

    return _ed25519.verify(
      message,
      signature: Signature(signatureBytes, publicKey: publicKey),
    );
  }
}
