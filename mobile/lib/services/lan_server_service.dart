import 'dart:async';
import 'dart:convert';
import 'dart:io';
import '../models/clipboard_event.dart';

/// Listens for incoming clipboard events from peer devices
abstract class LanServerService {
  Future<void> start();
  Future<void> stop();
  bool get isRunning;
  Stream<ClipboardEvent> get incomingEvents;
}

class LanServerServiceImpl implements LanServerService {
  final String _deviceId;
  final String _privateKeyPem;
  final int _port;

  ServerSocket? _serverSocket;
  bool _isRunning = false;
  late final StreamController<ClipboardEvent> _incomingEventsController;

  @override
  bool get isRunning => _isRunning;

  @override
  Stream<ClipboardEvent> get incomingEvents => _incomingEventsController.stream;

  LanServerServiceImpl({
    required String deviceId,
    required String privateKeyPem,
    int port = 9001,
  })  : _deviceId = deviceId,
        _privateKeyPem = privateKeyPem,
        _port = port {
    _incomingEventsController =
        StreamController<ClipboardEvent>.broadcast();
  }

  @override
  Future<void> start() async {
    if (_isRunning) return;

    try {
      _serverSocket = await ServerSocket.bind(
        InternetAddress.anyIPv4,
        _port,
      );

      _isRunning = true;
      print('LAN server listening on port $_port');

      // Accept incoming connections
      _acceptConnections();
    } catch (e) {
      print('Failed to start LAN server: $e');
      rethrow;
    }
  }

  void _acceptConnections() {
    _serverSocket?.listen(
      (socket) => _handleIncomingConnection(socket),
      onError: (error) => print('Server socket error: $error'),
      onDone: () => print('Server socket closed'),
    );
  }

  Future<void> _handleIncomingConnection(Socket socket) async {
    try {
      print('Incoming connection from ${socket.remoteAddress.address}:${socket.remotePort}');

      String? peerId;

      socket.listen(
        (data) async {
          try {
            final json = utf8.decode(data);
            final payload = jsonDecode(json) as Map<String, dynamic>;

            // Handle handshake
            if (payload['type'] == 'handshake') {
              peerId = payload['deviceId'] as String?;
              print('Handshake received from: $peerId');
              return;
            }

            // Handle clipboard event
            if (peerId != null) {
              final event = ClipboardEvent.fromJson(payload);

              // Validate sender
              if (event.senderDeviceId != peerId) {
                print('Event sender mismatch: expected $peerId, got ${event.senderDeviceId}');
                return;
              }

              // TODO: Decrypt payload using peerId's public key from roster

              _incomingEventsController.add(event);
              print('Received clipboard event from $peerId: ${event.eventId}');
            }
          } catch (e) {
            print('Error processing incoming data: $e');
          }
        },
        onError: (error) => print('Socket error from $peerId: $error'),
        onDone: () {
          print('Connection closed from $peerId');
          socket.close();
        },
      );
    } catch (e) {
      print('Error handling incoming connection: $e');
      await socket.close();
    }
  }

  @override
  Future<void> stop() async {
    if (!_isRunning) return;

    _isRunning = false;
    await _serverSocket?.close();
    print('LAN server stopped');
  }
}
