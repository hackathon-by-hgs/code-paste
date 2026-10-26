import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:cryptography/cryptography.dart';

import '../models/clipboard_event.dart';
import '../models/peer.dart';
import '../utils/secure_logging.dart';
import 'peer_authorizer.dart';
import 'secure_channel.dart';

/// A peer together with the address discovery found it at.
///
/// Discovery is untrusted input: an endpoint is only a claim that something is
/// reachable there. The handshake decides whether it is the device we meant.
class PeerEndpoint {
  final Peer peer;
  final InternetAddress address;
  final int port;

  const PeerEndpoint({
    required this.peer,
    required this.address,
    this.port = LanTransportServiceImpl.defaultPort,
  });
}

/// Opens outbound encrypted connections to authorized peers.
abstract class LanTransportService {
  Future<void> connectToEndpoint(PeerEndpoint endpoint);
  Future<void> sendEvent(ClipboardEvent event, String peerId);
  Stream<ClipboardEvent> get receivedEvents;
  Future<void> disconnect(String peerId);
  Future<void> shutdown();
  bool isConnectedToPeer(String peerId);
}

class LanTransportServiceImpl implements LanTransportService {
  static const int defaultPort = 9001;
  static const Duration connectionTimeout = Duration(seconds: 10);
  static const Duration handshakeTimeout = Duration(seconds: 5);

  /// Resolved on demand; see the note in [LanServerServiceImpl].
  final Future<SimpleKeyPair> Function() _staticKeyPair;
  final PeerAuthorizer _authorizer;
  final PayloadLimits Function() _limits;

  final Map<String, _PeerConnection> _connections = <String, _PeerConnection>{};
  StreamController<ClipboardEvent> _receivedEventsController =
      StreamController<ClipboardEvent>.broadcast();

  LanTransportServiceImpl({
    required Future<SimpleKeyPair> Function() staticKeyPair,
    required PeerAuthorizer authorizer,
    PayloadLimits Function()? limits,
  }) : _staticKeyPair = staticKeyPair,
       _authorizer = authorizer,
       _limits = limits ?? (() => const PayloadLimits());

  @override
  Stream<ClipboardEvent> get receivedEvents => _receivedEventsController.stream;

  @override
  bool isConnectedToPeer(String peerId) => _connections.containsKey(peerId);

  @override
  Future<void> connectToEndpoint(PeerEndpoint endpoint) async {
    final peer = endpoint.peer;
    if (isConnectedToPeer(peer.deviceId)) return;

    // Refuse to dial a peer the roster does not currently authorize, so an
    // expired roster stops outbound sync rather than relying on the remote end
    // to say no.
    if (_authorizer.authorizeKey(await _expectedKeyBytes(peer)) == null) {
      throw StateError('peer ${peer.deviceId} is not currently authorized');
    }

    if (_receivedEventsController.isClosed) {
      _receivedEventsController = StreamController<ClipboardEvent>.broadcast();
    }

    final socket = await Socket.connect(
      endpoint.address,
      endpoint.port,
      timeout: connectionTimeout,
    );

    SecureChannel? channel;
    try {
      channel = await SecureChannel.dial(
        incoming: socket,
        write: socket.add,
        flush: socket.flush,
        staticKeyPair: await _staticKeyPair(),
      ).timeout(handshakeTimeout);

      // We dialled an address; this confirms the device that answered is the
      // one the roster named, not merely some authorized device.
      if (!_authorizer.provenKeyMatches(peer, channel.peerStaticPublicKey)) {
        SecureLogging.logSecurity(
          'outbound_identity_mismatch',
          'address answered with a different identity than expected',
        );
        throw StateError('peer identity mismatch for ${peer.deviceId}');
      }

      final connection = _PeerConnection(
        peer: peer,
        channel: channel,
        socket: socket,
      );
      _connections[peer.deviceId] = connection;
      SecureLogging.logSyncEvent('Connected to peer ${peer.deviceId}');

      // Read replies without blocking the caller.
      unawaited(_readFrames(connection));
    } catch (e) {
      await channel?.close();
      await socket.close();
      rethrow;
    }
  }

  Future<List<int>> _expectedKeyBytes(Peer peer) async {
    // The roster carries the peer's public key; authorizing on it before we
    // dial keeps the check in one place.
    return base64.decode(peer.publicKey);
  }

  Future<void> _readFrames(_PeerConnection connection) async {
    try {
      while (_connections.containsKey(connection.peer.deviceId)) {
        final frame = await connection.channel.receive();
        if (frame == null) break;

        if (_authorizer.authorizeKey(connection.channel.peerStaticPublicKey) ==
            null) {
          SecureLogging.logSecurity(
            'outbound_deauthorized',
            'authorization withdrawn mid-connection',
          );
          break;
        }

        final event = _decodeFrame(frame, connection.peer);
        if (event != null) _receivedEventsController.add(event);
      }
    } catch (e) {
      SecureLogging.logSecurity('peer_stream_failed', '${e.runtimeType}');
    } finally {
      await disconnect(connection.peer.deviceId);
    }
  }

  ClipboardEvent? _decodeFrame(List<int> frame, Peer peer) {
    try {
      final decoded = jsonDecode(utf8.decode(frame));
      if (decoded is! Map<String, dynamic>) return null;

      final event = ClipboardEvent.decode(decoded, limits: _limits());
      if (event.senderDeviceId != peer.deviceId) {
        SecureLogging.logSecurity(
          'peer_sender_mismatch',
          'envelope claims a different device than the authenticated peer',
        );
        return null;
      }
      return event;
    } on EventRejectedException catch (e) {
      SecureLogging.logSecurity('peer_event_rejected', e.reason.name);
      return null;
    } catch (e) {
      SecureLogging.logSecurity('peer_undecodable', '${e.runtimeType}');
      return null;
    }
  }

  @override
  Future<void> sendEvent(ClipboardEvent event, String peerId) async {
    final connection = _connections[peerId];
    if (connection == null) {
      throw StateError('not connected to peer $peerId');
    }

    // Re-check at delivery: a revocation that landed since the connection
    // opened must stop the next payload, not just the next connection.
    if (_authorizer.authorizeKey(connection.channel.peerStaticPublicKey) ==
        null) {
      await disconnect(peerId);
      throw StateError('peer $peerId is no longer authorized');
    }

    if (!connection.peer.supportsContentType(event.contentType.mimeType)) {
      SecureLogging.logSyncEvent(
        'Peer $peerId does not accept ${event.contentType.mimeType}',
      );
      return;
    }

    if (!event.isValidUnder(_limits())) {
      SecureLogging.logSecurity(
        'outbound_event_invalid',
        'refused to send an event that fails its own contract checks',
      );
      return;
    }

    await connection.channel.send(utf8.encode(jsonEncode(event.toJson())));
    SecureLogging.logClipboardEvent('Sent event', event);
  }

  @override
  Future<void> disconnect(String peerId) async {
    final connection = _connections.remove(peerId);
    if (connection == null) return;

    await connection.channel.close();
    try {
      await connection.socket.close();
    } catch (_) {
      // Already gone.
    }
    developer.log('Disconnected from peer $peerId');
  }

  @override
  Future<void> shutdown() async {
    for (final peerId in _connections.keys.toList()) {
      await disconnect(peerId);
    }
    await _receivedEventsController.close();
    developer.log('LAN transport shutdown complete');
  }
}

class _PeerConnection {
  final Peer peer;
  final SecureChannel channel;
  final Socket socket;

  _PeerConnection({
    required this.peer,
    required this.channel,
    required this.socket,
  });
}
