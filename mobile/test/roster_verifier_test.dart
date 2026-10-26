import 'dart:convert';

import 'package:copy_and_paste/models/peer.dart';
import 'package:copy_and_paste/services/roster_verifier.dart';
import 'package:copy_and_paste/services/roster_version_store.dart';
import 'package:copy_and_paste/utils/roster_signature_verifier.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';

const String selfDeviceId = 'cp_dev_01h2jkmnp3q4r5s6t7v8w9xyz0';
const String otherDeviceId = 'cp_dev_02h2jkmnp3q4r5s6t7v8w9xyz0';
const String userId = 'cp_usr_01h2jkmnp3q4r5s6t7v8w9xyz0';
const String keyId = 'cp_rk_01h2jkmnp3q4r5s6t7v8w9xyz0';
const String otherKeyId = 'cp_rk_02h2jkmnp3q4r5s6t7v8w9xyz0';

Map<String, dynamic> rosterPayload({
  String deviceId = selfDeviceId,
  int rosterVersion = 7,
  Duration expiresIn = const Duration(minutes: 5),
  int protocolVersion = 1,
}) {
  final now = DateTime.now().toUtc();
  return <String, dynamic>{
    'protocolVersion': protocolVersion,
    'rosterVersion': rosterVersion,
    'issuedAt': now.toIso8601String(),
    'expiresAt': now.add(expiresIn).toIso8601String(),
    'self': <String, dynamic>{
      'deviceId': deviceId,
      'userId': userId,
      'keyFingerprint': 'sha256:${'a' * 64}',
    },
    'peers': <dynamic>[],
    'limits': <String, dynamic>{
      'text/plain': 1048576,
      'image/png': 10485760,
      'image/jpeg': 10485760,
    },
  };
}

void main() {
  final ed25519 = Ed25519();

  late SimpleKeyPair controlPlaneKeys;
  late String controlPlanePublicKeyBase64;
  late RosterSignatureVerifier signatures;
  late RosterVersionStore versions;
  late RosterVerifier verifier;

  setUp(() async {
    controlPlaneKeys = await ed25519.newKeyPair();
    final publicKey = await controlPlaneKeys.extractPublicKey();
    controlPlanePublicKeyBase64 = base64.encode(publicKey.bytes);

    signatures = RosterSignatureVerifier();
    versions = InMemoryRosterVersionStore();
    verifier = RosterVerifier(
      signatureVerifier: signatures,
      versionStore: versions,
    );
  });

  /// Signs [payload] with [keyPair], producing the wire shape the control plane
  /// sends: base64 payload bytes plus a detached signature over those bytes.
  Future<SignedPeerRoster> sign(
    Map<String, dynamic> payload, {
    SimpleKeyPair? keyPair,
    String algorithm = 'ed25519',
    String signingKeyId = keyId,
  }) async {
    final bytes = utf8.encode(jsonEncode(payload));
    final signature = await ed25519.sign(
      bytes,
      keyPair: keyPair ?? controlPlaneKeys,
    );
    return SignedPeerRoster(
      payload: base64.encode(bytes),
      signatureAlgorithm: algorithm,
      signatureKeyId: signingKeyId,
      signatureValue: base64.encode(signature.bytes),
    );
  }

  Future<PeerRoster> verify(SignedPeerRoster signed) =>
      verifier.verifyAndParse(signed: signed, selfDeviceId: selfDeviceId);

  Matcher rejectedBecause(RosterRejection reason) => throwsA(
    isA<RosterRejectedException>().having((e) => e.reason, 'reason', reason),
  );

  group('key registration', () {
    test('accepts a well-formed control plane key', () {
      expect(
        signatures.registerKey(keyId, controlPlanePublicKeyBase64),
        isTrue,
      );
      expect(signatures.trustedKeyCount, 1);
    });

    test('rejects a key of the wrong length', () {
      // 16 bytes rather than 32: structurally base64, but not an Ed25519 key.
      expect(
        signatures.registerKey(keyId, base64.encode(List.filled(16, 1))),
        isFalse,
      );
      expect(signatures.trustedKeyCount, 0);
    });

    test('rejects a malformed key id', () {
      expect(
        signatures.registerKey('not-a-key-id', controlPlanePublicKeyBase64),
        isFalse,
      );
      expect(signatures.trustedKeyCount, 0);
    });
  });

  group('RosterVerifier', () {
    test('accepts a correctly signed roster issued to this device', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      final roster = await verify(await sign(rosterPayload()));

      expect(roster.rosterVersion, 7);
      expect(roster.self.deviceId, selfDeviceId);
      expect(roster.payloadLimits['text/plain'], 1048576);
    });

    test('rejects a roster signed by a key it does not trust', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);
      final attacker = await ed25519.newKeyPair();

      await expectLater(
        verify(await sign(rosterPayload(), keyPair: attacker)),
        rejectedBecause(RosterRejection.badSignature),
      );
    });

    test('rejects a roster when no key is registered at all', () async {
      // The previous implementation returned "valid" in exactly this case,
      // which let anyone on the LAN forge a roster.
      expect(signatures.trustedKeyCount, 0);

      await expectLater(
        verify(await sign(rosterPayload())),
        rejectedBecause(RosterRejection.badSignature),
      );
    });

    test('rejects a signature made for an unknown key id', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      await expectLater(
        verify(await sign(rosterPayload(), signingKeyId: otherKeyId)),
        rejectedBecause(RosterRejection.badSignature),
      );
    });

    test('rejects a tampered payload', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);
      final signed = await sign(rosterPayload());

      // Re-encode a different roster under the original signature.
      final tampered = SignedPeerRoster(
        payload: base64.encode(
          utf8.encode(jsonEncode(rosterPayload(rosterVersion: 99))),
        ),
        signatureAlgorithm: signed.signatureAlgorithm,
        signatureKeyId: signed.signatureKeyId,
        signatureValue: signed.signatureValue,
      );

      await expectLater(
        verify(tampered),
        rejectedBecause(RosterRejection.badSignature),
      );
    });

    test('verifies before parsing', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      // Valid base64, but not JSON at all. If the implementation parsed first
      // the rejection would be unparseablePayload; ADR-003 requires that the
      // signature is checked over the raw bytes before a decoder ever runs.
      final signed = SignedPeerRoster(
        payload: base64.encode(utf8.encode('not json')),
        signatureAlgorithm: 'ed25519',
        signatureKeyId: keyId,
        signatureValue: base64.encode(List.filled(64, 0)),
      );

      await expectLater(
        verify(signed),
        rejectedBecause(RosterRejection.badSignature),
      );
    });

    test('rejects a non-ed25519 algorithm', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      await expectLater(
        verify(await sign(rosterPayload(), algorithm: 'rsa-pss')),
        rejectedBecause(RosterRejection.unsupportedAlgorithm),
      );
    });

    test('rejects a roster issued to another device', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      await expectLater(
        verify(await sign(rosterPayload(deviceId: otherDeviceId))),
        rejectedBecause(RosterRejection.wrongDevice),
      );
    });

    test('rejects an unsupported protocol version', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      await expectLater(
        verify(await sign(rosterPayload(protocolVersion: 2))),
        rejectedBecause(RosterRejection.unsupportedProtocolVersion),
      );
    });

    test('rejects an expired roster', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      await expectLater(
        verify(
          await sign(rosterPayload(expiresIn: const Duration(seconds: -1))),
        ),
        rejectedBecause(RosterRejection.expired),
      );
    });

    test('rejects a rosterVersion that has gone backwards', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);

      await verify(await sign(rosterPayload(rosterVersion: 12)));

      // A stale roster replayed to reinstate a since-revoked peer.
      await expectLater(
        verify(await sign(rosterPayload(rosterVersion: 11))),
        rejectedBecause(RosterRejection.rollback),
      );
    });

    test(
      'accepts the same version twice and advances on a newer one',
      () async {
        signatures.registerKey(keyId, controlPlanePublicKeyBase64);

        await verify(await sign(rosterPayload(rosterVersion: 4)));
        await verify(await sign(rosterPayload(rosterVersion: 4)));
        final newer = await verify(await sign(rosterPayload(rosterVersion: 5)));

        expect(newer.rosterVersion, 5);
        expect(await versions.highWaterMark(selfDeviceId), 5);
      },
    );

    test('does not record a high-water mark for a rejected roster', () async {
      signatures.registerKey(keyId, controlPlanePublicKeyBase64);
      final attacker = await ed25519.newKeyPair();

      await expectLater(
        verify(await sign(rosterPayload(rosterVersion: 50), keyPair: attacker)),
        rejectedBecause(RosterRejection.badSignature),
      );

      expect(await versions.highWaterMark(selfDeviceId), isNull);
    });
  });
}
