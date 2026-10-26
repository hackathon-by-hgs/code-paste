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

/// Accepts inbound clipboard connections from authorized peers.
///
/// Nothing is read off a connection until the peer has both proven its identity
/// through the handshake and been found in the current signed roster. Reaching
/// this port is not an authorization of any kind: a connection from an
/// unauthorized or unprovable peer is closed without a single frame being
/// decoded.
abstract class LanServerService {
  Future<void> start();
  Future<void> stop();
  bool get isRunning;
  Stream<ClipboardEvent> get incomingEvents;
}

class LanServerServiceImpl implements LanServerService {
  static const int defaultPort = 9001;

  final int _port;

  /// Resolved on demand: the signing key lives in secure storage and is only
  /// available after the device has been registered.
  final Future<SimpleKeyPair> Function() _staticKeyPair;
  final PeerAuthorizer _authorizer;
  final PayloadLimits Function() _limits;

  ServerSocket? _serverSocket;
  bool _isRunning = false;
  final Set<SecureChannel> _channels = <SecureChannel>{};
  StreamController<ClipboardEvent> _incomingEventsController =
      StreamController<ClipboardEvent>.broadcast();

  LanServerServiceImpl({
    required Future<SimpleKeyPair> Function() staticKeyPair,
    required PeerAuthorizer authorizer,
    PayloadLimits Function()? limits,
    int port = defaultPort,
  }) : _staticKeyPair = staticKeyPair,
       _authorizer = authorizer,
       _limits = limits ?? (() => const PayloadLimits()),
       _port = port;

  @override
  bool get isRunning => _isRunning;

  /// The port actually bound, which differs from [defaultPort] when the caller
  /// asked for an ephemeral one.
  int? get boundPort => _serverSocket?.port;

  @override
  Stream<ClipboardEvent> get incomingEvents => _incomingEventsController.stream;

  @override
  Future<void> start() async {
    if (_isRunning) return;

    if (_incomingEventsController.isClosed) {
      _incomingEventsController = StreamController<ClipboardEvent>.broadcast();
    }

    _serverSocket = await ServerSocket.bind(InternetAddress.anyIPv4, _port);
    _isRunning = true;
    developer.log('LAN server listening on port $_port');

    _serverSocket!.listen(
      _handleConnection,
      onError: (Object e) => developer.log('Server socket error: $e'),
      onDone: () => developer.log('Server socket closed'),
    );
  }

  Future<void> _handleConnection(Socket socket) async {
    SecureChannel? channel;
    try {
      channel = await SecureChannel.accept(
        incoming: socket,
        write: socket.add,
        flush: socket.flush,
        staticKeyPair: await _staticKeyPair(),
      );

      // The handshake established *who*. The roster decides *whether*.
      final peer = _authorizer.authorizeKey(channel.peerStaticPublicKey);
      if (peer == null) {
        SecureLogging.logSecurity(
          'inbound_rejected',
          'peer proved an identity that is not authorized',
        );
        await channel.close();
        await socket.close();
        return;
      }

      _channels.add(channel);
      SecureLogging.logSyncEvent('Authorized inbound peer ${peer.deviceId}');
      await _readFrames(channel, peer);
    } catch (e) {
      // A failed handshake is routine — an unauthorized scanner, a wrong
      // version, a dropped connection. Log the class, never the bytes.
      SecureLogging.logSecurity('inbound_handshake_failed', '${e.runtimeType}');
    } finally {
      if (channel != null) {
        _channels.remove(channel);
        await channel.close();
      }
      try {
        await socket.close();
      } catch (_) {
        // Already gone.
      }
    }
  }

  Future<void> _readFrames(SecureChannel channel, Peer peer) async {
    while (_isRunning) {
      final frame = await channel.receive();
      if (frame == null) return; // Clean close.

      // Authorization is re-checked per delivery, not just at connect, so
      // revoking a device drops it from live connections rather than only from
      // new ones.
      if (_authorizer.authorizeKey(channel.peerStaticPublicKey) == null) {
        SecureLogging.logSecurity(
          'inbound_deauthorized',
          'authorization withdrawn mid-connection',
        );
        return;
      }

      final event = _decodeFrame(frame, peer);
      if (event != null) _incomingEventsController.add(event);
    }
  }

  ClipboardEvent? _decodeFrame(List<int> frame, Peer peer) {
    try {
      final decoded = jsonDecode(utf8.decode(frame));
      if (decoded is! Map<String, dynamic>) {
        SecureLogging.logSecurity(
          'inbound_malformed',
          'frame is not an object',
        );
        return null;
      }

      final event = ClipboardEvent.decode(decoded, limits: _limits());

      // The sender id inside the envelope must be the peer that actually
      // authenticated. Otherwise an authorized device could relay events
      // attributed to another one.
      if (event.senderDeviceId != peer.deviceId) {
        SecureLogging.logSecurity(
          'inbound_sender_mismatch',
          'envelope claims a different device than the authenticated peer',
        );
        return null;
      }

      if (!peer.supportsContentType(event.contentType.mimeType)) {
        SecureLogging.logSecurity(
          'inbound_unsupported_content_type',
          event.contentType.mimeType,
        );
        return null;
      }

      return event;
    } on EventRejectedException catch (e) {
      SecureLogging.logSecurity('inbound_event_rejected', e.reason.name);
      return null;
    } catch (e) {
      SecureLogging.logSecurity('inbound_undecodable', '${e.runtimeType}');
      return null;
    }
  }

  @override
  Future<void> stop() async {
    if (!_isRunning) return;

    _isRunning = false;
    await _serverSocket?.close();
    _serverSocket = null;

    for (final channel in _channels.toList()) {
      await channel.close();
    }
    _channels.clear();

    await _incomingEventsController.close();
    developer.log('LAN server stopped');
  }
}
