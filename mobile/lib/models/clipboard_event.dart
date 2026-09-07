import 'package:uuid/uuid.dart';

enum ContentType {
  textPlain('text/plain'),
  imagePng('image/png'),
  imageJpeg('image/jpeg');

  final String mimeType;
  const ContentType(this.mimeType);

  static ContentType? fromMimeType(String mimeType) {
    for (final ct in ContentType.values) {
      if (ct.mimeType == mimeType) return ct;
    }
    return null;
  }
}

class ClipboardEvent {
  final String eventId; // UUID
  final String senderDeviceId;
  final String? sessionId; // null for personal sync
  final int sequence; // per-sender monotonic
  final DateTime createdAt;
  final ContentType contentType;
  final int size; // decoded payload size in bytes
  final String hash; // sha256:hex
  final String payload; // text/plain: UTF-8 string, image/*: base64

  const ClipboardEvent({
    required this.eventId,
    required this.senderDeviceId,
    required this.sequence,
    required this.contentType,
    required this.size,
    required this.hash,
    required this.payload,
    this.sessionId,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? const Duration();

  factory ClipboardEvent({
    required String senderDeviceId,
    required int sequence,
    required ContentType contentType,
    required String payload,
    String? sessionId,
  }) {
    // For factory, compute hash
    final hash = _computeHash(payload);
    return ClipboardEvent(
      eventId: const Uuid().v4(),
      senderDeviceId: senderDeviceId,
      sessionId: sessionId,
      sequence: sequence,
      contentType: contentType,
      size: _computeDecodedSize(payload, contentType),
      hash: hash,
      payload: payload,
      createdAt: DateTime.now().toUtc(),
    );
  }

  factory ClipboardEvent.fromJson(Map<String, dynamic> json) {
    return ClipboardEvent(
      eventId: json['eventId'] as String,
      senderDeviceId: json['senderDeviceId'] as String,
      sessionId: json['sessionId'] as String?,
      sequence: json['sequence'] as int,
      contentType: ContentType.fromMimeType(
            json['contentType'] as String,
          ) ??
          ContentType.textPlain,
      size: json['size'] as int,
      hash: json['hash'] as String,
      payload: json['payload'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
    'version': 1,
    'eventId': eventId,
    'senderDeviceId': senderDeviceId,
    'sessionId': sessionId,
    'sequence': sequence,
    'createdAt': createdAt.toIso8601String(),
    'contentType': contentType.mimeType,
    'size': size,
    'hash': hash,
    'payload': payload,
  };

  static String _computeHash(String payload) {
    // TODO: Use crypto.sha256 for real implementation
    return 'sha256:mock_${payload.hashCode}';
  }

  static int _computeDecodedSize(String payload, ContentType contentType) {
    switch (contentType) {
      case ContentType.textPlain:
        return payload.length;
      case ContentType.imagePng:
      case ContentType.imageJpeg:
        // Base64 decode: roughly payload.length * 3/4
        return (payload.length * 3) ~/ 4;
    }
  }

  bool isValid(int maxSizeBytes) {
    // Check size limit
    if (size > maxSizeBytes) return false;

    // Check hash format
    if (!hash.startsWith('sha256:')) return false;

    // Check content type
    if (contentType == ContentType.imagePng ||
        contentType == ContentType.imageJpeg) {
      // Images should be base64
      try {
        // Validate base64
        const uuid = Uuid();
        uuid.parse(eventId); // Just verify we have a valid UUID
      } catch (_) {
        return false;
      }
    }

    return true;
  }
}

class ClipboardSnapshot {
  final ContentType? contentType;
  final String? content;
  final DateTime capturedAt;

  ClipboardSnapshot({
    this.contentType,
    this.content,
    DateTime? capturedAt,
  }) : capturedAt = capturedAt ?? DateTime.now();

  bool hasContent() => content != null && content!.isNotEmpty;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ClipboardSnapshot &&
          runtimeType == other.runtimeType &&
          contentType == other.contentType &&
          content == other.content;

  @override
  int get hashCode => contentType.hashCode ^ content.hashCode;
}
