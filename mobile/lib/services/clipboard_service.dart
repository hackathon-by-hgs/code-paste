import 'package:flutter/services.dart';
import '../models/clipboard_event.dart';

abstract class ClipboardService {
  Stream<ClipboardSnapshot> get clipboardStream;
  Future<ClipboardSnapshot?> readClipboard();
  Future<void> writeClipboard(String content, ContentType contentType);
  Future<void> dispose();
}

class ClipboardServiceImpl implements ClipboardService {
  static const platform = MethodChannel('com.hgs.copypaste/clipboard');

  ClipboardSnapshot? _lastSnapshot;
  late final Stream<ClipboardSnapshot> _clipboardStream;

  @override
  Stream<ClipboardSnapshot> get clipboardStream => _clipboardStream;

  ClipboardServiceImpl() {
    _clipboardStream = _createClipboardStream();
  }

  Stream<ClipboardSnapshot> _createClipboardStream() async* {
    while (true) {
      await Future.delayed(const Duration(seconds: 2));
      try {
        final snapshot = await readClipboard();
        if (snapshot != null && snapshot != _lastSnapshot) {
          _lastSnapshot = snapshot;
          yield snapshot;
        }
      } catch (e) {
        // Silently ignore polling errors
      }
    }
  }

  @override
  Future<ClipboardSnapshot?> readClipboard() async {
    try {
      final result = await platform.invokeMethod<Map<dynamic, dynamic>>(
        'getClipboard',
      );

      if (result == null) {
        return ClipboardSnapshot();
      }

      final content = result['content'] as String?;
      final contentTypeStr = result['contentType'] as String?;

      ContentType? contentType;
      if (contentTypeStr != null) {
        contentType = ContentType.fromMimeType(contentTypeStr);
      }

      return ClipboardSnapshot(contentType: contentType, content: content);
    } on PlatformException catch (e) {
      throw Exception('Failed to read clipboard: ${e.message}');
    }
  }

  @override
  Future<void> writeClipboard(String content, ContentType contentType) async {
    try {
      await platform.invokeMethod('setClipboard', {
        'content': content,
        'contentType': contentType.mimeType,
      });

      _lastSnapshot = ClipboardSnapshot(
        contentType: contentType,
        content: content,
      );
    } on PlatformException catch (e) {
      throw Exception('Failed to write clipboard: ${e.message}');
    }
  }

  @override
  Future<void> dispose() async {
    // Cleanup resources
  }
}
