import 'dart:convert';
import '../models/clipboard_event.dart';
import 'clipboard_service.dart';
import 'peer_discovery_service.dart';

abstract class ClipboardSyncService {
  Future<void> start();
  Future<void> stop();
  bool get isRunning;
  Future<void> sendClipboardEvent(ClipboardEvent event);
  Stream<ClipboardEvent> get receivedEvents;
}

class ClipboardSyncServiceImpl implements ClipboardSyncService {
  final ClipboardService _clipboardService;
  final PeerDiscoveryService _peerDiscoveryService;
  final String _deviceId;

  bool _isRunning = false;
  ClipboardSnapshot? _lastSyncedSnapshot;
  int _eventSequence = 0;

  late final Stream<ClipboardEvent> _receivedEventsStream;

  @override
  bool get isRunning => _isRunning;

  @override
  Stream<ClipboardEvent> get receivedEvents => _receivedEventsStream;

  ClipboardSyncServiceImpl({
    required ClipboardService clipboardService,
    required PeerDiscoveryService peerDiscoveryService,
    required String deviceId,
  })  : _clipboardService = clipboardService,
        _peerDiscoveryService = peerDiscoveryService,
        _deviceId = deviceId {
    _receivedEventsStream = _createReceivedEventsStream();
  }

  @override
  Future<void> start() async {
    if (_isRunning) return;

    _isRunning = true;

    // Listen to clipboard changes
    _clipboardService.clipboardStream.listen(
      (snapshot) => _onClipboardChanged(snapshot),
      onError: (e) => print('Clipboard monitoring error: $e'),
    );
  }

  @override
  Future<void> stop() async {
    _isRunning = false;
  }

  Future<void> _onClipboardChanged(ClipboardSnapshot snapshot) async {
    if (!_isRunning || !snapshot.hasContent()) return;

    // Skip if content unchanged
    if (snapshot == _lastSyncedSnapshot) return;

    _lastSyncedSnapshot = snapshot;

    // Create event
    final contentType = snapshot.contentType ?? ContentType.textPlain;
    final event = ClipboardEvent(
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
    if (!_peerDiscoveryService.isRosterValid()) {
      print('Peer roster not valid, cannot send event');
      return;
    }

    final peers = _peerDiscoveryService.getAvailablePeers();
    if (peers.isEmpty) {
      print('No available peers to send clipboard event');
      return;
    }

    final eventJson = event.toJson();
    final payload = jsonEncode(eventJson);

    // TODO: Send payload to each peer
    // - Encrypt with peer's public key
    // - Send over LAN socket
    // - Handle retries and errors
    print('Would send event to ${peers.length} peers: ${event.eventId}');
  }

  Stream<ClipboardEvent> _createReceivedEventsStream() async* {
    // TODO: Listen for incoming clipboard events from peers
    // - Accept encrypted event payloads
    // - Decrypt using device's private key
    // - Validate against peer roster
    // - Yield valid events
    yield* const Stream.empty();
  }
}
