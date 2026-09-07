import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import '../models/clipboard_event.dart';
import '../models/peer.dart';

/// Manages encrypted LAN connections between peers
abstract class LanTransportService {
  Future<void> connectToPeer(Peer peer);
  Future<void> sendEvent(ClipboardEvent event, String peerId);
  Stream<ClipboardEvent> get receivedEvents;
  Future<void> disconnect(String peerId);
  Future<void> shutdown();
  bool isConnectedToPeer(String peerId);
}

class LanTransportServiceImpl implements LanTransportService {
  final String _deviceId;
  final String _privateKeyPem;
  final Map<String, Socket> _peerSockets = {};
  final Map<String, StreamSubscription> _peerListeners = {};
  late final StreamController<ClipboardEvent> _receivedEventsController;

  static const int defaultPort = 9001; // Copy-paste LAN port
  static const int connectionTimeoutSeconds = 10;

  @override
  Stream<ClipboardEvent> get receivedEvents => _receivedEventsController.stream;

  LanTransportServiceImpl({
    required String deviceId,
    required String privateKeyPem,
  })  : _deviceId = deviceId,
        _privateKeyPem = privateKeyPem {
    _receivedEventsController = StreamController<ClipboardEvent>.broadcast();
  }

  @override
  Future<void> connectToPeer(Peer peer) async {
    if (isConnectedToPeer(peer.deviceId)) {
      return; // Already connected
    }

    try {
      // TODO: Resolve peer IP address (mDNS or peer registry)
      // For now, assume we have peer IP from discovery
      final peerAddress = _resolvePeerAddress(peer);
      if (peerAddress == null) {
        throw Exception('Could not resolve peer address: ${peer.deviceId}');
      }

      // Connect with timeout
      final socket = await Socket.connect(
        peerAddress,
        defaultPort,
        timeout: Duration(seconds: connectionTimeoutSeconds),
      ).timeout(
        Duration(seconds: connectionTimeoutSeconds),
        onTimeout: () => throw SocketException('Connection timeout'),
      );

      _peerSockets[peer.deviceId] = socket;

      // Listen for incoming messages
      _setupPeerListener(peer.deviceId, socket, peer.publicKey);

      // Send handshake
      await _sendHandshake(socket, peer);

      print('Connected to peer: ${peer.deviceId}');
    } catch (e) {
      print('Failed to connect to peer ${peer.deviceId}: $e');
      await disconnect(peer.deviceId);
      rethrow;
    }
  }

  void _setupPeerListener(
    String peerId,
    Socket socket,
    String peerPublicKey,
  ) {
    final listener = socket.listen(
      (data) => _onPeerData(peerId, data, peerPublicKey),
      onError: (error) => _onPeerError(peerId, error),
      onDone: () => _onPeerDisconnected(peerId),
    );

    _peerListeners[peerId] = listener;
  }

  void _onPeerData(String peerId, List<int> data, String peerPublicKey) {
    try {
      final json = utf8.decode(data);
      final payload = jsonDecode(json) as Map<String, dynamic>;

      // TODO: Decrypt payload using peerPublicKey
      // For now, assume plaintext
      final event = ClipboardEvent.fromJson(payload);

      // Validate sender
      if (event.senderDeviceId != peerId) {
        print('Event sender mismatch: expected $peerId, got ${event.senderDeviceId}');
        return;
      }

      _receivedEventsController.add(event);
    } catch (e) {
      print('Error processing peer data from $peerId: $e');
    }
  }

  void _onPeerError(String peerId, dynamic error) {
    print('Peer $peerId socket error: $error');
    disconnect(peerId);
  }

  void _onPeerDisconnected(String peerId) {
    print('Peer disconnected: $peerId');
    disconnect(peerId);
  }

  @override
  Future<void> sendEvent(ClipboardEvent event, String peerId) async {
    if (!isConnectedToPeer(peerId)) {
      throw Exception('Not connected to peer: $peerId');
    }

    try {
      final socket = _peerSockets[peerId]!;
      final json = jsonEncode(event.toJson());

      // TODO: Encrypt JSON payload with peer's public key
      // For now, send plaintext
      final data = utf8.encode(json);

      socket.add(data);
      await socket.flush();

      print('Sent event ${event.eventId} to $peerId');
    } catch (e) {
      print('Failed to send event to $peerId: $e');
      await disconnect(peerId);
      rethrow;
    }
  }

  Future<void> _sendHandshake(Socket socket, Peer peer) async {
    try {
      final handshake = {
        'type': 'handshake',
        'deviceId': _deviceId,
        'protocolVersion': 1,
        'timestamp': DateTime.now().toIso8601String(),
      };

      final json = jsonEncode(handshake);
      final data = utf8.encode(json);

      socket.add(data);
      await socket.flush();

      print('Handshake sent to ${peer.deviceId}');
    } catch (e) {
      print('Handshake failed: $e');
      rethrow;
    }
  }

  @override
  bool isConnectedToPeer(String peerId) {
    final socket = _peerSockets[peerId];
    return socket != null && !socket.done;
  }

  @override
  Future<void> disconnect(String peerId) async {
    try {
      _peerListeners[peerId]?.cancel();
      _peerListeners.remove(peerId);

      final socket = _peerSockets.remove(peerId);
      await socket?.close();

      print('Disconnected from peer: $peerId');
    } catch (e) {
      print('Error disconnecting from $peerId: $e');
    }
  }

  @override
  Future<void> shutdown() async {
    final peerIds = List<String>.from(_peerSockets.keys);
    for (final peerId in peerIds) {
      await disconnect(peerId);
    }

    await _receivedEventsController.close();
    print('LAN transport shutdown complete');
  }

  /// Resolve peer IP from device ID (mDNS or peer registry lookup)
  /// TODO: Implement actual mDNS resolution
  String? _resolvePeerAddress(Peer peer) {
    // Placeholder: In production, use mDNS to resolve <deviceId>.local
    // For now, would be filled from network discovery
    print('TODO: Resolve ${peer.deviceId} IP address via mDNS');
    return null; // Require external resolution for now
  }
}

/// Encryption utilities for LAN transport
class TransportEncryption {
  /// Encrypt payload with recipient's public key (RSA)
  static String encryptPayload(
    String payload,
    String recipientPublicKeyPem,
  ) {
    // TODO: Implement RSA encryption
    // Use pointycastle RSAPublicKey from PEM
    return payload; // Mock: return plaintext
  }

  /// Decrypt payload with device's private key (RSA)
  static String decryptPayload(
    String encryptedPayload,
    String devicePrivateKeyPem,
  ) {
    // TODO: Implement RSA decryption
    // Use pointycastle RSAPrivateKey from PEM
    return encryptedPayload; // Mock: return as-is
  }

  /// Compute HMAC signature for integrity check
  static String signPayload(
    String payload,
    String devicePrivateKeyPem,
  ) {
    // TODO: Implement Ed25519 signature
    // For MVP, use HMAC-SHA256
    final bytes = utf8.encode(payload);
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  /// Verify HMAC signature
  static bool verifySignature(
    String payload,
    String signature,
    String senderPublicKeyPem,
  ) {
    // TODO: Verify Ed25519 signature
    final expected = signPayload(payload, senderPublicKeyPem);
    return expected == signature;
  }
}
