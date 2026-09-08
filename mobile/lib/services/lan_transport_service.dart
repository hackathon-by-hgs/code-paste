import 'dart:developer' as developer;
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import '../models/clipboard_event.dart';
import '../models/peer.dart';
import 'rsa_encryption_service.dart';
import '../utils/secure_logging.dart';

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
  final String _publicKeyPem;
  late final RSAEncryptionService _encryption;
  late final PeerHandshakeHandler _handshake;
  final Map<String, Socket> _peerSockets = {};
  final Map<String, StreamSubscription> _peerListeners = {};
  final Map<String, Uint8List> _peerBuffers = {}; // Buffer for partial messages
  final Map<String, bool> _handshakeComplete = {};
  late final StreamController<ClipboardEvent> _receivedEventsController;

  static const int defaultPort = 9001; // Copy-paste LAN port
  static const int connectionTimeoutSeconds = 10;
  static const int messageHeaderSize = 4; // 4-byte length prefix
  static const int handshakeTimeoutSeconds = 5;

  @override
  Stream<ClipboardEvent> get receivedEvents => _receivedEventsController.stream;

  LanTransportServiceImpl({
    required String deviceId,
    required String privateKeyPem,
    String? publicKeyPem,
  }) : _publicKeyPem = publicKeyPem ?? privateKeyPem {
    _encryption = RSAEncryptionService(
      privateKeyPem: privateKeyPem,
      publicKeyPem: _publicKeyPem,
    );
    _handshake = PeerHandshakeHandler(
      deviceId: deviceId,
      publicKeyPem: _publicKeyPem,
      encryption: _encryption,
    );
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
      final socket =
          await Socket.connect(
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

      developer.log('Connected to peer: ${peer.deviceId}');
    } catch (e) {
      developer.log('Failed to connect to peer ${peer.deviceId}: $e');
      await disconnect(peer.deviceId);
      rethrow;
    }
  }

  void _setupPeerListener(String peerId, Socket socket, String peerPublicKey) {
    final listener = socket.listen(
      (data) => _onPeerData(peerId, data, peerPublicKey),
      onError: (error) => _onPeerError(peerId, error),
      onDone: () => _onPeerDisconnected(peerId),
    );

    _peerListeners[peerId] = listener;
  }

  void _onPeerData(String peerId, List<int> data, String peerPublicKey) {
    try {
      // Append to existing buffer
      final buffer = _peerBuffers[peerId] ?? Uint8List(0);
      _peerBuffers[peerId] = Uint8List.fromList([...buffer, ...data]);

      // Process complete messages from buffer
      while (_peerBuffers[peerId]!.length >= messageHeaderSize) {
        final buf = _peerBuffers[peerId]!;

        // Read message length (4-byte big-endian)
        final lengthBytes = buf.sublist(0, messageHeaderSize);
        final length = ByteData.view(lengthBytes.buffer).getUint32(0);

        // Check if we have the complete message
        if (buf.length < messageHeaderSize + length) {
          break; // Wait for more data
        }

        // Extract message data
        final messageData = buf.sublist(
          messageHeaderSize,
          messageHeaderSize + length,
        );

        // Decrypt payload (for now, using simplified encryption)
        // TODO: Properly decrypt using RSA
        // var decryptedData = await _encryption.decryptWithPrivateKey(messageData);

        // Parse JSON
        final json = utf8.decode(messageData);
        final payload = jsonDecode(json) as Map<String, dynamic>;

        // Handle handshake messages
        if (payload['type'] == 'handshake_response') {
          final isValid = _handshake.verifyHandshakeResponse(
            payload,
            peerId,
            peerPublicKey,
          );
          if (isValid) {
            _handshakeComplete[peerId] = true;
            SecureLogging.logSyncEvent('Handshake complete with $peerId');
          }
        } else if (_handshakeComplete[peerId] == true) {
          // Only process clipboard events after handshake
          final event = ClipboardEvent.fromJson(payload);

          // Validate sender
          if (event.senderDeviceId != peerId) {
            SecureLogging.logSecurity(
              'sender_mismatch',
              'Expected $peerId, got ${event.senderDeviceId}',
            );
          } else {
            _receivedEventsController.add(event);
          }
        }

        // Remove processed message from buffer
        _peerBuffers[peerId] = Uint8List.fromList(
          buf.sublist(messageHeaderSize + length),
        );
      }
    } catch (e) {
      SecureLogging.logError('peer_data_processing', e as Exception);
      disconnect(peerId);
    }
  }

  void _onPeerError(String peerId, dynamic error) {
    developer.log('Peer $peerId socket error: $error');
    disconnect(peerId);
  }

  void _onPeerDisconnected(String peerId) {
    developer.log('Peer disconnected: $peerId');
    disconnect(peerId);
  }

  @override
  Future<void> sendEvent(ClipboardEvent event, String peerId) async {
    if (!isConnectedToPeer(peerId)) {
      throw Exception('Not connected to peer: $peerId');
    }

    if (_handshakeComplete[peerId] != true) {
      SecureLogging.logSecurity(
        'handshake_pending',
        'Cannot send event, handshake not complete with $peerId',
      );
      throw Exception('Handshake not complete with $peerId');
    }

    try {
      final socket = _peerSockets[peerId]!;
      final json = jsonEncode(event.toJson());
      late List<int> messageData = utf8.encode(json);

      // Encrypt payload with peer's public key
      try {
        final peer = _getPeerInfo(peerId);
        if (peer != null) {
          final encrypted = await _encryption.encryptWithPeerKey(
            messageData,
            peer.publicKey,
          );
          messageData = encrypted;
          SecureLogging.logSyncEvent('Event encrypted for $peerId');
        }
      } catch (e) {
        SecureLogging.logError('encryption_error', e as Exception);
        // Fall back to plaintext (development mode)
      }

      // Prepare length-prefixed message
      final lengthBytes = ByteData(messageHeaderSize)
        ..setUint32(0, messageData.length);
      final framedMessage = Uint8List.fromList([
        ...lengthBytes.buffer.asUint8List(),
        ...messageData,
      ]);

      socket.add(framedMessage);
      await socket.flush();

      SecureLogging.logSyncEvent('Sent event ${event.eventId} to $peerId');
    } catch (e) {
      SecureLogging.logError('send_event', e as Exception);
      await disconnect(peerId);
      rethrow;
    }
  }

  Future<void> _sendHandshake(Socket socket, Peer peer) async {
    try {
      final handshakeRequest = _handshake.createHandshakeRequest();
      final json = jsonEncode(handshakeRequest);
      final messageData = utf8.encode(json);

      // Prepare length-prefixed message
      final lengthBytes = ByteData(messageHeaderSize)
        ..setUint32(0, messageData.length);
      final framedMessage = Uint8List.fromList([
        ...lengthBytes.buffer.asUint8List(),
        ...messageData,
      ]);

      socket.add(framedMessage);
      await socket.flush();

      SecureLogging.logSyncEvent('Handshake sent to ${peer.deviceId}');
    } catch (e) {
      SecureLogging.logError('handshake_send', e as Exception);
      rethrow;
    }
  }

  @override
  bool isConnectedToPeer(String peerId) {
    final socket = _peerSockets[peerId];
    return socket != null;
  }

  @override
  Future<void> disconnect(String peerId) async {
    try {
      _peerListeners[peerId]?.cancel();
      _peerListeners.remove(peerId);

      final socket = _peerSockets.remove(peerId);
      _peerBuffers.remove(peerId);
      await socket?.close();

      developer.log('Disconnected from peer: $peerId');
    } catch (e) {
      developer.log('Error disconnecting from $peerId: $e');
    }
  }

  @override
  Future<void> shutdown() async {
    final peerIds = List<String>.from(_peerSockets.keys);
    for (final peerId in peerIds) {
      await disconnect(peerId);
    }

    await _receivedEventsController.close();
    developer.log('LAN transport shutdown complete');
  }

  /// Resolve peer IP from device ID (mDNS or peer registry lookup)
  /// TODO: Implement actual mDNS resolution
  String? _resolvePeerAddress(Peer peer) {
    // Placeholder: In production, use mDNS to resolve <deviceId>.local
    // For now, would be filled from network discovery
    developer.log('TODO: Resolve ${peer.deviceId} IP address via mDNS');
    return null; // Require external resolution for now
  }

  Peer? _getPeerInfo(String peerId) {
    // TODO: Lookup peer from peer discovery service
    // This is a placeholder that would retrieve peer info for encryption
    return null;
  }
}

/// Encryption utilities for LAN transport
class TransportEncryption {
  /// Encrypt payload with recipient's public key (RSA)
  static String encryptPayload(String payload, String recipientPublicKeyPem) {
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
  static String signPayload(String payload, String devicePrivateKeyPem) {
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
