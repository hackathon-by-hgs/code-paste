import '../models/peer.dart';
import '../utils/device_key.dart';
import '../utils/secure_logging.dart';
import 'peer_discovery_service.dart';

/// Decides whether a peer whose identity has been cryptographically proven is
/// also *authorized* to exchange clipboard data right now.
///
/// Three independent checks gate sync, and none of them is sufficient alone:
///
///   1. **Discovery** says a device exists — an unverified claim from the
///      network.
///   2. **The roster** says an identity is authorized — signed by the control
///      plane, bound to this device, and short-lived.
///   3. **The handshake** proves the peer holds the private key for that
///      identity.
///
/// This class is step 2, and it is deliberately the only place that answers the
/// question. Because it reads through the roster cache, an expired roster
/// authorizes nobody: authorization decays rather than requiring a revocation
/// message to arrive.
class PeerAuthorizer {
  final PeerDiscoveryService _discovery;

  PeerAuthorizer(this._discovery);

  /// Returns the authorized peer matching a proven static public key, or null.
  Peer? authorizeKey(List<int> peerStaticPublicKey) {
    final String fingerprint;
    try {
      fingerprint = DeviceKey.fingerprintOfBytes(peerStaticPublicKey);
    } on ArgumentError {
      SecureLogging.logSecurity('peer_key_malformed', 'wrong key length');
      return null;
    }

    final peer = _discovery.findPeerByFingerprint(fingerprint);
    if (peer == null) {
      // Either the roster does not list this device, or the roster has expired
      // and therefore lists nothing. Both mean "not authorized".
      SecureLogging.logSecurity(
        'peer_not_authorized',
        'proven identity is absent from the current roster',
      );
      return null;
    }
    return peer;
  }

  /// Confirms a proven key belongs to the peer we intended to reach.
  ///
  /// Guards against connecting to one authorized device while believing it is a
  /// different one.
  bool provenKeyMatches(Peer expected, List<int> peerStaticPublicKey) {
    try {
      return DeviceKey.fingerprintOfBytes(peerStaticPublicKey) ==
          expected.keyFingerprint;
    } on ArgumentError {
      return false;
    }
  }

  /// True while the roster backing these decisions is still valid.
  bool get isAuthorizationFresh => _discovery.isRosterValid();
}
