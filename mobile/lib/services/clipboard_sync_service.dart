import 'dart:developer' as developer;
import 'dart:async';
import '../models/clipboard_event.dart';
import 'clipboard_service.dart';
import 'peer_discovery_service.dart';
import 'transport_service.dart';

abstract class ClipboardSyncService {
  Future<void> start();
  Future<void> stop();
  bool get isRunning;
  Future<void> sendClipboardEvent(ClipboardEvent event);
  Stream<ClipboardEvent> get receivedEvents;
  Future<void> dispose();
}

class ClipboardSyncServiceImpl implements ClipboardSyncService {
  final ClipboardService _clipboardService;
  final PeerDiscoveryService _peerDiscoveryService;
  final TransportService _transport;
  final String _deviceId;

  bool _isRunning = false;
  ClipboardSnapshot? _lastSyncedSnapshot;
  int _eventSequence = 0;
  StreamSubscription? _clipboardSubscription;
  late final StreamController<ClipboardEvent> _receivedEventsController;

  @override
  bool get isRunning => _isRunning;

  @override
  Stream<ClipboardEvent> get receivedEvents => _receivedEventsController.stream;

  ClipboardSyncServiceImpl({
    required ClipboardService clipboardService,
    required PeerDiscoveryService peerDiscoveryService,
    required TransportService transport,
    required String deviceId,
  }) : _clipboardService = clipboardService,
       _peerDiscoveryService = peerDiscoveryService,
       _transport = transport,
       _deviceId = deviceId {
    _receivedEventsController = StreamController<ClipboardEvent>.broadcast();
    _setupReceivedEventsForwarding();
  }

  void _setupReceivedEventsForwarding() {
    _transport.receivedEvents.listen((event) async {
      try {
        // Write received event to clipboard
        await _clipboardService.writeClipboard(
          event.payload,
          event.contentType,
        );
        developer.log('Wrote received event to clipboard: ${event.eventId}');
      } catch (e) {
        developer.log('Failed to write clipboard: $e');
      }

      _receivedEventsController.add(event);
    }, onError: (e) => developer.log('Error receiving event: $e'));
  }

  @override
  Future<void> start() async {
    if (_isRunning) return;

    _isRunning = true;
    developer.log('Clipboard sync started');

    // Verify roster is valid
    if (!_peerDiscoveryService.isRosterValid()) {
      developer.log('Warning: Peer roster not valid at start');
    }

    // Get available peers and start transport
    final peers = _peerDiscoveryService.getAvailablePeers();
    if (peers.isNotEmpty) {
      try {
        await _transport.start(peers);
        developer.log('Transport started with ${peers.length} peers');
      } catch (e) {
        developer.log('Failed to start transport: $e');
      }
    } else {
      developer.log('No peers available to connect');
    }

    // Listen to clipboard changes
    _clipboardSubscription = _clipboardService.clipboardStream.listen(
      (snapshot) => _onClipboardChanged(snapshot),
      onError: (e) => developer.log('Clipboard monitoring error: $e'),
    );
  }

  @override
  Future<void> stop() async {
    _isRunning = false;
    await _clipboardSubscription?.cancel();
    await _transport.stop();
    developer.log('Clipboard sync stopped');
  }

  Future<void> _onClipboardChanged(ClipboardSnapshot snapshot) async {
    if (!_isRunning || !snapshot.hasContent()) return;

    // Skip if content unchanged
    if (snapshot == _lastSyncedSnapshot) return;

    _lastSyncedSnapshot = snapshot;

    // Create event
    final contentType = snapshot.contentType ?? ContentType.textPlain;
    final event = ClipboardEvent.create(
      senderDeviceId: _deviceId,
      sequence: ++_eventSequence,
      contentType: contentType,
      payload: snapshot.content ?? '',
    );

    // Send to peers
    await sendClipboardEvent(event);
  }

  @override
  Future<void> sendClipboardEvent(ClipboardEvent event) async {
    if (!_transport.isRunning) {
      developer.log('Transport not running, cannot send event');
      return;
    }

    if (!_peerDiscoveryService.isRosterValid()) {
      developer.log('Peer roster not valid, cannot send event');
      return;
    }

    final peers = _peerDiscoveryService.getAvailablePeers();
    if (peers.isEmpty) {
      developer.log('No available peers to send clipboard event');
      return;
    }

    int sentCount = 0;
    for (final peer in peers) {
      try {
        await _transport.sendEvent(event, peer.deviceId);
        sentCount++;
      } catch (e) {
        developer.log('Failed to send event to ${peer.deviceId}: $e');
      }
    }

    developer.log(
      'Sent event ${event.eventId} to $sentCount/${peers.length} peers',
    );
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _receivedEventsController.close();
    developer.log('Clipboard sync service disposed');
  }
}
