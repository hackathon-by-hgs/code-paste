import 'dart:convert';
import 'dart:io';

import 'package:copy_and_paste/models/clipboard_event.dart';
import 'package:copy_and_paste/models/peer.dart';
import 'package:copy_and_paste/services/lan_server_service.dart';
import 'package:copy_and_paste/services/peer_authorizer.dart';
import 'package:copy_and_paste/services/peer_discovery_service.dart';
import 'package:copy_and_paste/services/secure_channel.dart';
import 'package:copy_and_paste/utils/device_key.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';

const String senderDeviceId = 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41';
const String otherDeviceId = 'cp_dev_02h2xcejqtf2nbrexx3vqjhp41';
const String userId = 'cp_usr_01h2xcejqtf2nbrexx3vqjhp41';

/// A roster containing exactly the peers a test chooses to authorize.
class _StubDiscovery implements PeerDiscoveryService {
  final List<Peer> peers;

  /// Flipped mid-test to simulate a roster expiring.
  bool rosterValid = true;

  _StubDiscovery(this.peers);

  @override
  Peer? findPeerByFingerprint(String fingerprint) {
    if (!rosterValid) return null;
    for (final peer in peers) {
      if (peer.keyFingerprint == fingerprint) return peer;
    }
    return null;
  }

  @override
  Peer? findPeerByDeviceId(String deviceId) {
    if (!rosterValid) return null;
    for (final peer in peers) {
      if (peer.deviceId == deviceId) return peer;
    }
    return null;
  }

  @override
  List<Peer> getAvailablePeers() => rosterValid ? peers : const <Peer>[];

  @override
  bool isRosterValid() => rosterValid;

  @override
  bool registerControlPlaneKey(String keyId, String publicKeyBase64) => true;

  @override
  int get trustedKeyCount => 1;

  @override
  Future<PeerRoster> fetchPeerRoster() =>
      throw UnimplementedError('not used in these tests');

  @override
  Future<void> refreshPeerRoster() =>
      throw UnimplementedError('not used in these tests');
}

Peer _peerFor(String publicKeyBase64, {String deviceId = senderDeviceId}) {
  return Peer(
    deviceId: deviceId,
    userId: userId,
    publicKey: publicKeyBase64,
    keyFingerprint: DeviceKey.fingerprintOfBase64(publicKeyBase64),
    platform: 'macos',
    protocolVersion: 1,
    capabilities: const <String>['text/plain'],
    scope: 'personal',
  );
}

void main() {
  final ed25519 = Ed25519();

  late SimpleKeyPair serverKeys;
  late SimpleKeyPair clientKeys;
  late String clientPublicKeyBase64;

  setUp(() async {
    serverKeys = await ed25519.newKeyPair();
    clientKeys = await ed25519.newKeyPair();
    clientPublicKeyBase64 = base64.encode(
      (await clientKeys.extractPublicKey()).bytes,
    );
  });

  /// Dials the server and completes the handshake as [clientKeys].
  Future<({Socket socket, SecureChannel channel})> dial(int port) async {
    final socket = await Socket.connect(InternetAddress.loopbackIPv4, port);
    final channel = await SecureChannel.dial(
      incoming: socket,
      write: socket.add,
      flush: socket.flush,
      staticKeyPair: clientKeys,
    );
    return (socket: socket, channel: channel);
  }

  Map<String, dynamic> eventJson({String from = senderDeviceId}) {
    return ClipboardEvent.create(
      senderDeviceId: from,
      sequence: 1,
      contentType: ContentType.textPlain,
      payload: 'hello from the LAN',
    ).toJson();
  }

  test('delivers an event from an authorized, proven peer', () async {
    final discovery = _StubDiscovery([_peerFor(clientPublicKeyBase64)]);
    final server = LanServerServiceImpl(
      staticKeyPair: () async => serverKeys,
      authorizer: PeerAuthorizer(discovery),
      port: 0,
    );
    await server.start();
    addTearDown(server.stop);

    final received = server.incomingEvents.first;
    final connection = await dial(server.boundPort!);
    await connection.channel.send(utf8.encode(jsonEncode(eventJson())));

    final event = await received.timeout(const Duration(seconds: 5));
    expect(event.senderDeviceId, senderDeviceId);
    expect(event.payload, 'hello from the LAN');

    await connection.channel.close();
    await connection.socket.close();
  });

  test('drops a peer that proves an identity the roster does not list', () async {
    // The handshake will succeed -- the client genuinely holds its key -- but
    // the roster does not authorize it. Reaching the port is not authorization.
    final discovery = _StubDiscovery(const <Peer>[]);
    final server = LanServerServiceImpl(
      staticKeyPair: () async => serverKeys,
      authorizer: PeerAuthorizer(discovery),
      port: 0,
    );
    await server.start();
    addTearDown(server.stop);

    var delivered = 0;
    final sub = server.incomingEvents.listen((_) => delivered++);
    addTearDown(sub.cancel);

    final connection = await dial(server.boundPort!);
    await connection.channel.send(utf8.encode(jsonEncode(eventJson())));

    // Give the server every chance to (wrongly) deliver it.
    await Future<void>.delayed(const Duration(milliseconds: 500));
    expect(delivered, 0);

    await connection.channel.close();
    await connection.socket.close();
  });

  test('drops an event whose envelope claims a different device', () async {
    final discovery = _StubDiscovery([_peerFor(clientPublicKeyBase64)]);
    final server = LanServerServiceImpl(
      staticKeyPair: () async => serverKeys,
      authorizer: PeerAuthorizer(discovery),
      port: 0,
    );
    await server.start();
    addTearDown(server.stop);

    var delivered = 0;
    final sub = server.incomingEvents.listen((_) => delivered++);
    addTearDown(sub.cancel);

    final connection = await dial(server.boundPort!);
    await connection.channel.send(
      utf8.encode(jsonEncode(eventJson(from: otherDeviceId))),
    );

    await Future<void>.delayed(const Duration(milliseconds: 500));
    expect(delivered, 0);

    await connection.channel.close();
    await connection.socket.close();
  });

  test('delivers nothing once the roster has expired', () async {
    final discovery = _StubDiscovery([_peerFor(clientPublicKeyBase64)]);
    final server = LanServerServiceImpl(
      staticKeyPair: () async => serverKeys,
      authorizer: PeerAuthorizer(discovery),
      port: 0,
    );
    await server.start();
    addTearDown(server.stop);

    var delivered = 0;
    final sub = server.incomingEvents.listen((_) => delivered++);
    addTearDown(sub.cancel);

    // An expired roster authorizes nobody: this is how revocation propagates
    // without any message having to be delivered.
    discovery.rosterValid = false;

    final connection = await dial(server.boundPort!);
    await connection.channel.send(utf8.encode(jsonEncode(eventJson())));

    await Future<void>.delayed(const Duration(milliseconds: 500));
    expect(delivered, 0);

    await connection.channel.close();
    await connection.socket.close();
  });

  test(
    'a peer that cannot complete the handshake is never authorized',
    () async {
      final discovery = _StubDiscovery([_peerFor(clientPublicKeyBase64)]);
      final server = LanServerServiceImpl(
        staticKeyPair: () async => serverKeys,
        authorizer: PeerAuthorizer(discovery),
        port: 0,
      );
      await server.start();
      addTearDown(server.stop);

      var delivered = 0;
      final sub = server.incomingEvents.listen((_) => delivered++);
      addTearDown(sub.cancel);

      // Raw garbage instead of a handshake: an unsupported version byte.
      final socket = await Socket.connect(
        InternetAddress.loopbackIPv4,
        server.boundPort!,
      );
      socket.add(<int>[99, ...List<int>.filled(64, 0)]);
      await socket.flush();

      await Future<void>.delayed(const Duration(milliseconds: 500));
      expect(delivered, 0);

      await socket.close();
    },
  );
}
