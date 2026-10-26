import 'dart:convert';

import '../models/peer.dart';
import '../utils/roster_signature_verifier.dart';
import '../utils/secure_logging.dart';
import 'roster_version_store.dart';

/// Why a roster was refused. Named rather than free text so tests can assert
/// the precise rejection and callers can react without matching on strings.
enum RosterRejection {
  unsupportedAlgorithm,
  malformedPayload,
  badSignature,
  unparseablePayload,
  unsupportedProtocolVersion,
  wrongDevice,
  rollback,
  expired,
}

class RosterRejectedException implements Exception {
  final RosterRejection reason;
  final String detail;

  RosterRejectedException(this.reason, this.detail);

  @override
  String toString() => 'RosterRejectedException(${reason.name}): $detail';
}

/// Verifies a signed peer roster and only then parses it.
///
/// The order below is mandated by ADR-003 and is the whole point of this class:
///
///   1. signature, over the payload bytes exactly as received
///   2. parse
///   3. the roster was issued to *this* device
///   4. `rosterVersion` has not gone backwards
///   5. it has not expired
///
/// Verifying before parsing is not a style preference. The roster is delivered
/// as detached-signed opaque bytes specifically so that no implementation has
/// to canonicalise JSON to check a signature — divergent canonicalisation
/// across platforms is a signature-bypass bug waiting to happen. Parsing first
/// would also mean running a JSON decoder over unauthenticated attacker input.
class RosterVerifier {
  final RosterSignatureVerifier _signatures;
  final RosterVersionStore _versions;

  RosterVerifier({
    required RosterSignatureVerifier signatureVerifier,
    required RosterVersionStore versionStore,
  }) : _signatures = signatureVerifier,
       _versions = versionStore;

  Future<PeerRoster> verifyAndParse({
    required SignedPeerRoster signed,
    required String selfDeviceId,
    DateTime? now,
  }) async {
    // v1 has no algorithm agility. Anything but ed25519 is a downgrade attempt.
    if (signed.signatureAlgorithm != RosterSignatureVerifier.algorithm) {
      throw _reject(
        RosterRejection.unsupportedAlgorithm,
        'algorithm=${signed.signatureAlgorithm}',
      );
    }

    final List<int> payloadBytes;
    try {
      payloadBytes = base64.decode(signed.payload);
    } on FormatException catch (e) {
      throw _reject(RosterRejection.malformedPayload, e.message);
    }
    if (payloadBytes.isEmpty) {
      throw _reject(RosterRejection.malformedPayload, 'empty payload');
    }

    // 1. Signature first, over the bytes as transmitted.
    final signatureValid = await _signatures.verify(
      keyId: signed.signatureKeyId,
      signatureBase64: signed.signatureValue,
      message: payloadBytes,
    );
    if (!signatureValid) {
      throw _reject(
        RosterRejection.badSignature,
        'keyId=${signed.signatureKeyId}',
      );
    }

    // 2. Only now is it safe to parse.
    final PeerRoster roster;
    try {
      final decoded = jsonDecode(utf8.decode(payloadBytes));
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('roster payload is not a JSON object');
      }
      roster = PeerRoster.fromJson(decoded);
    } catch (e) {
      // A correctly signed but unparseable roster means the control plane and
      // this client disagree about the contract. Refuse rather than guess.
      throw _reject(RosterRejection.unparseablePayload, e.toString());
    }

    if (roster.protocolVersion != 1) {
      throw _reject(
        RosterRejection.unsupportedProtocolVersion,
        'protocolVersion=${roster.protocolVersion}',
      );
    }

    // 3. A roster issued for device A must never be honoured by device B.
    if (roster.self.deviceId != selfDeviceId) {
      throw _reject(
        RosterRejection.wrongDevice,
        'roster is for another device',
      );
    }

    // 4. Rollback detection.
    final seen = await _versions.highWaterMark(selfDeviceId);
    if (seen != null && roster.rosterVersion < seen) {
      throw _reject(
        RosterRejection.rollback,
        'rosterVersion=${roster.rosterVersion} < seen=$seen',
      );
    }

    // 5. Expiry. This is how revocation propagates without push delivery:
    // authorization decays by default.
    final at = now ?? DateTime.now();
    if (!roster.expiresAt.isAfter(at)) {
      throw _reject(RosterRejection.expired, 'expiresAt=${roster.expiresAt}');
    }

    await _versions.record(selfDeviceId, roster.rosterVersion);
    return roster;
  }

  RosterRejectedException _reject(RosterRejection reason, String detail) {
    SecureLogging.logSecurity('roster_rejected_${reason.name}', detail);
    return RosterRejectedException(reason, detail);
  }
}
