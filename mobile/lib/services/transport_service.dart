import 'dart:developer' as developer;
import 'dart:async';
import '../models/clipboard_event.dart';
import '../models/peer.dart';
import 'lan_transport_service.dart';
import 'lan_server_service.dart';

/// Unified transport service managing both client and server connections
abstract class TransportService {
  Future<void> start(List<Peer> peers);
  Future<void> stop();
  bool get isRunning;
  Future<void> sendEvent(ClipboardEvent event, String peerId);
  Stream<ClipboardEvent> get receivedEvents;
}

class TransportServiceImpl implements TransportService {
  final LanTransportService _clientTransport;
  final LanServerService _serverService;
  late final StreamController<ClipboardEvent> _receivedEventsController;
  bool _isRunning = false;

  @override
  bool get isRunning => _isRunning;

  @override
  Stream<ClipboardEvent> get receivedEvents => _receivedEventsController.stream;

  TransportServiceImpl({
    required LanTransportService clientTransport,
    required LanServerService serverService,
  }) : _clientTransport = clientTransport,
       _serverService = serverService {
    _receivedEventsController = StreamController<ClipboardEvent>.broadcast();
    _setupEventForwarding();
  }

  void _setupEventForwarding() {
    // Forward events from client transport (responses from peers)
    _clientTransport.receivedEvents.listen(
      (event) => _receivedEventsController.add(event),
      onError: (e) => developer.log('Client transport error: $e'),
    );

    // Forward events from server (incoming from peers)
    _serverService.incomingEvents.listen(
      (event) => _receivedEventsController.add(event),
      onError: (e) => developer.log('Server service error: $e'),
    );
  }

  @override
  Future<void> start(List<Peer> peers) async {
    if (_isRunning) return;

    try {
      // Recreate stream controller if it was closed
      if (_receivedEventsController.isClosed) {
        _receivedEventsController =
            StreamController<ClipboardEvent>.broadcast();
        _setupEventForwarding();
      }

      // Start listening for incoming connections
      await _serverService.start();

      // Connect to all peers (outbound)
      for (final peer in peers) {
        try {
          await _clientTransport.connectToPeer(peer);
        } catch (e) {
          developer.log('Failed to connect to peer ${peer.deviceId}: $e');
          // Continue with other peers even if one fails
        }
      }

      _isRunning = true;
      developer.log('Transport service started');
    } catch (e) {
      developer.log('Failed to start transport service: $e');
      await _serverService.stop();
      rethrow;
    }
  }

  @override
  Future<void> stop() async {
    if (!_isRunning) return;

    _isRunning = false;
    await _serverService.stop();
    await _clientTransport.shutdown();
    await _receivedEventsController.close();
    developer.log('Transport service stopped');
  }

  @override
  Future<void> sendEvent(ClipboardEvent event, String peerId) async {
    if (!_isRunning) {
      throw Exception('Transport service not running');
    }

    await _clientTransport.sendEvent(event, peerId);
  }
}
