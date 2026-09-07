import 'package:uuid/uuid.dart';
import 'package:crypto/crypto.dart';
import 'dart:convert';

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
  static const int version = 1; // Protocol version per spec

  final String eventId; // UUID
  final String senderDeviceId;
  final String? sessionId; // null for personal sync
  final int sequence; // per-sender monotonic
  final DateTime createdAt;
  final ContentType contentType;
  final int size; // decoded payload size in bytes
  final String hash; // sha256:hex
  final String payload; // text/plain: UTF-8 string, image/*: base64

  ClipboardEvent({
    required this.eventId,
    required this.senderDeviceId,
    required this.sequence,
    required this.contentType,
    required this.size,
    required this.hash,
    required this.payload,
    this.sessionId,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now().toUtc();

  /// Factory to create event with computed hash and size
  factory ClipboardEvent.create({
    required String senderDeviceId,
    required int sequence,
    required ContentType contentType,
    required String payload,
    String? sessionId,
  }) {
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
    // Validate version is supported
    final jsonVersion = json['version'] as int?;
    if (jsonVersion != version) {
      throw FormatException(
        'Unsupported protocol version: $jsonVersion, expected $version',
      );
    }

    return ClipboardEvent(
      eventId: json['eventId'] as String,
      senderDeviceId: json['senderDeviceId'] as String,
      sessionId: json['sessionId'] as String?,
      sequence: json['sequence'] as int,
      contentType:
          ContentType.fromMimeType(json['contentType'] as String) ??
          ContentType.textPlain,
      size: json['size'] as int,
      hash: json['hash'] as String,
      payload: json['payload'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
    'version': version,
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
    // Use SHA256 for real implementation
    final bytes = utf8.encode(payload);
    final digest = sha256.convert(bytes);
    return 'sha256:${digest.toString()}';
  }

  static int _computeDecodedSize(String payload, ContentType contentType) {
    switch (contentType) {
      case ContentType.textPlain:
        // UTF-8 byte count, not character count
        return utf8.encode(payload).length;
      case ContentType.imagePng:
      case ContentType.imageJpeg:
        // Base64 decode: roughly payload.length * 3/4
        return (payload.length * 3) ~/ 4;
    }
  }

  bool isValid(int maxSizeBytes) {
    // Check version is supported
    if (version != 1) return false;

    // Check size limit (must be 0-10485760 bytes per spec)
    if (size < 0 || size > 10485760) return false;
    if (size > maxSizeBytes) return false;

    // Check hash format: "sha256:<64 lowercase hex chars>"
    final hashRegex = RegExp(r'^sha256:[0-9a-f]{64}$');
    if (!hashRegex.hasMatch(hash)) return false;

    // Check event ID is valid UUID (v1-v8 format per RFC 4122)
    if (!_isValidUUID(eventId)) return false;

    // Check sequence is in valid range (0 to 2^53-1)
    if (sequence < 0 || sequence > 9007199254740991) return false;

    // Check content type is supported
    try {
      ContentType.fromMimeType(contentType.mimeType);
    } catch (_) {
      return false;
    }

    // Validate payload encoding and size
    if (!_validatePayloadEncoding(payload, contentType)) return false;

    // Verify hash matches payload
    if (!_verifyHash()) return false;

    return true;
  }

  bool _isValidUUID(String uuid) {
    // UUID format: xxxxxxxx-xxxx-[1-8]xxx-[89ab]xxx-xxxxxxxxxxxx
    final uuidRegex = RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    );
    return uuidRegex.hasMatch(uuid);
  }

  bool _validatePayloadEncoding(String payload, ContentType contentType) {
    switch (contentType) {
      case ContentType.textPlain:
        // UTF-8 text is always valid
        return true;
      case ContentType.imagePng:
      case ContentType.imageJpeg:
        // Payload must be valid base64
        try {
          // Attempt decode to validate base64
          const Base64Codec().decode(payload.replaceAll(RegExp(r'\s'), ''));
          return true;
        } catch (_) {
          return false;
        }
    }
  }

  bool _verifyHash() {
    try {
      final expectedHash = _computeHash(payload);
      return expectedHash == hash;
    } catch (_) {
      return false;
    }
  }
}

class ClipboardSnapshot {
  final ContentType? contentType;
  final String? content;
  final DateTime capturedAt;

  ClipboardSnapshot({this.contentType, this.content, DateTime? capturedAt})
    : capturedAt = capturedAt ?? DateTime.now();

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
