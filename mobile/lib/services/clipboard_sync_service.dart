import 'dart:developer' as developer;
import 'dart:async';
import '../models/clipboard_event.dart';
import '../utils/secure_logging.dart';
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

  // Event deduplication: keep track of received eventIds to prevent echo loops
  final Set<String> _receivedEventIds = {};
  static const int _maxDedupeCache = 1000; // Prevent unbounded memory growth
  static const int _maxPayloadSize = 10485760; // 10 MB per spec

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
      // Deduplication: skip if we've already processed this event
      if (_receivedEventIds.contains(event.eventId)) {
        developer.log('Skipping duplicate event: ${event.eventId}');
        return;
      }

      // Add to dedup cache
      _receivedEventIds.add(event.eventId);

      // Limit cache size to prevent unbounded growth
      if (_receivedEventIds.length > _maxDedupeCache) {
        // Remove oldest entry (simple FIFO via removing first from Set view)
        final toRemove = _receivedEventIds.first;
        _receivedEventIds.remove(toRemove);
      }

      try {
        // Validate event against schema
        if (!event.isValid(_maxPayloadSize)) {
          SecureLogging.logSecurity('invalid_event', 'Event failed validation');
          return;
        }

        // Write received event to clipboard
        await _clipboardService.writeClipboard(
          event.payload,
          event.contentType,
        );
        developer.log('Wrote received event to clipboard: ${event.eventId}');
      } catch (e) {
        developer.log('Error processing received event: $e');
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
    // Validate event before sending
    if (!event.isValid(_maxPayloadSize)) {
      SecureLogging.logSecurity('oversized_payload', 'Event size ${event.size} exceeds limit');
      return;
    }

    if (!_transport.isRunning) {
      SecureLogging.logSyncEvent('Transport not running, cannot send event');
      return;
    }

    if (!_peerDiscoveryService.isRosterValid()) {
      SecureLogging.logSyncEvent('Peer roster not valid, cannot send event');
      return;
    }

    final peers = _peerDiscoveryService.getAvailablePeers();
    if (peers.isEmpty) {
      SecureLogging.logSyncEvent('No available peers to send clipboard event');
      return;
    }

    for (final peer in peers) {
      try {
        await _transport.sendEvent(event, peer.deviceId);
      } catch (e) {
        SecureLogging.logError('sendEvent', e as Exception);
      }
    }

    SecureLogging.logClipboardEvent('Sent event', event);
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _receivedEventsController.close();
    developer.log('Clipboard sync service disposed');
  }
}
