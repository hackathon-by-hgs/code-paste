import '../models/network.dart';
import '../models/peer.dart';
import '../utils/roster_signature_verifier.dart';
import '../utils/secure_logging.dart';
import 'api_client.dart';
import 'roster_verifier.dart';
import 'roster_version_store.dart';

abstract class PeerDiscoveryService {
  Future<PeerRoster> fetchPeerRoster();
  Future<void> refreshPeerRoster();
  Peer? findPeerByDeviceId(String deviceId);
  Peer? findPeerByFingerprint(String fingerprint);
  List<Peer> getAvailablePeers();
  bool isRosterValid();

  /// Registers a control-plane roster signing key. Returns false if the key is
  /// malformed, in which case nothing is trusted.
  bool registerControlPlaneKey(String keyId, String publicKeyBase64);

  /// How many control-plane keys are trusted. Zero means no roster can verify,
  /// and therefore that no peer is authorized.
  int get trustedKeyCount;
}

class PeerDiscoveryServiceImpl implements PeerDiscoveryService {
  final ApiClient _apiClient;
  final Future<String?> Function() _selfDeviceId;
  final RosterSignatureVerifier _signatures;
  final RosterVerifier _verifier;

  PeerRoster? _cachedRoster;

  factory PeerDiscoveryServiceImpl({
    required ApiClient apiClient,
    required Future<String?> Function() selfDeviceId,
    RosterSignatureVerifier? signatureVerifier,
    RosterVersionStore? versionStore,
  }) {
    return PeerDiscoveryServiceImpl._(
      apiClient,
      selfDeviceId,
      signatureVerifier ?? RosterSignatureVerifier(),
      versionStore ?? SecureRosterVersionStore(),
    );
  }

  PeerDiscoveryServiceImpl._(
    this._apiClient,
    this._selfDeviceId,
    RosterSignatureVerifier signatures,
    RosterVersionStore versionStore,
  ) : _signatures = signatures,
      _verifier = RosterVerifier(
        signatureVerifier: signatures,
        versionStore: versionStore,
      );

  @override
  int get trustedKeyCount => _signatures.trustedKeyCount;

  @override
  Future<PeerRoster> fetchPeerRoster() async {
    final selfDeviceId = await _selfDeviceId();
    if (selfDeviceId == null || selfDeviceId.isEmpty) {
      // Without our own device identity there is no way to check that the
      // roster was issued to us, so there is no safe way to use one.
      throw StateError('cannot fetch a peer roster before device registration');
    }

    final response = await _apiClient.get('/authz/peer-set', withAuth: true);
    final signed = SignedPeerRoster.fromJson(response);

    // A rejection here deliberately leaves any previously verified roster in
    // place: ADR-003 lets LAN sync survive a control-plane problem until the
    // cached roster expires on its own. What a rejection must never do is
    // adopt the roster that failed.
    final roster = await _verifier.verifyAndParse(
      signed: signed,
      selfDeviceId: selfDeviceId,
    );

    _cachedRoster = roster;
    SecureLogging.logSyncEvent(
      'Peer roster accepted: version=${roster.rosterVersion} '
      'peers=${roster.peers.length}',
    );
    return roster;
  }

  @override
  Future<void> refreshPeerRoster() async {
    await fetchPeerRoster();
  }

  @override
  Peer? findPeerByDeviceId(String deviceId) {
    if (!isRosterValid()) return null;
    return _cachedRoster!.findPeerByDeviceId(deviceId);
  }

  @override
  Peer? findPeerByFingerprint(String fingerprint) {
    if (!isRosterValid()) return null;
    return _cachedRoster!.findPeerByFingerprint(fingerprint);
  }

  @override
  List<Peer> getAvailablePeers() {
    if (!isRosterValid()) return const <Peer>[];
    return _cachedRoster!.peers;
  }

  @override
  bool isRosterValid() {
    final roster = _cachedRoster;
    return roster != null && !roster.isExpired();
  }

  @override
  bool registerControlPlaneKey(String keyId, String publicKeyBase64) {
    final registered = _signatures.registerKey(keyId, publicKeyBase64);
    if (!registered) {
      SecureLogging.logSecurity(
        'roster_key_rejected',
        'malformed key id or key material',
      );
    }
    return registered;
  }

  /// Resolves a device discovered on the LAN to an authorized peer.
  ///
  /// Discovery is untrusted input: it only claims a device exists. A match here
  /// means the identity is *authorized*; the transport handshake still has to
  /// prove the peer holds the matching private key.
  Peer? matchNetworkToPeer(Network network) {
    if (!isRosterValid()) return null;

    final deviceId = network.deviceId;
    if (deviceId == null) return null;
    return _cachedRoster!.findPeerByDeviceId(deviceId);
  }
}
