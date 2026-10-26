import 'dart:convert';

import 'package:crypto/crypto.dart';
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

  bool get isImage => this != ContentType.textPlain;
}

/// Why an event was refused. Named so that tests — and the contract vectors in
/// particular — can assert the precise reason rather than just "invalid".
enum EventRejection {
  unknownField,
  missingField,
  unsupportedVersion,
  malformedEventId,
  malformedSenderId,
  malformedSessionId,
  malformedTimestamp,
  unsupportedContentType,
  malformedHash,
  badSequence,
  sizeOutOfRange,
  payloadNotBase64,
  sizeMismatch,
  hashMismatch,
  overTypeLimit,
}

class EventRejectedException implements Exception {
  final EventRejection reason;
  final String detail;

  const EventRejectedException(this.reason, this.detail);

  @override
  String toString() => 'EventRejectedException(${reason.name}): $detail';
}

/// Authoritative per-content-type payload limits.
///
/// The control plane publishes these in every roster (`limits`), which is what
/// makes it the single source of truth — two agents enforcing different
/// ceilings is how one of them ends up dropping what the other happily sent.
/// The defaults here are only a fallback for before the first roster arrives.
class PayloadLimits {
  final int textPlain;
  final int imagePng;
  final int imageJpeg;

  const PayloadLimits({
    this.textPlain = 1048576,
    this.imagePng = 10485760,
    this.imageJpeg = 10485760,
  });

  /// Reads the limits a verified roster published. Missing entries keep the
  /// conservative default rather than becoming unlimited.
  factory PayloadLimits.fromRoster(Map<String, int> limits) {
    const fallback = PayloadLimits();
    return PayloadLimits(
      textPlain: limits['text/plain'] ?? fallback.textPlain,
      imagePng: limits['image/png'] ?? fallback.imagePng,
      imageJpeg: limits['image/jpeg'] ?? fallback.imageJpeg,
    );
  }

  int forContentType(ContentType contentType) {
    switch (contentType) {
      case ContentType.textPlain:
        return textPlain;
      case ContentType.imagePng:
        return imagePng;
      case ContentType.imageJpeg:
        return imageJpeg;
    }
  }
}

class ClipboardEvent {
  static const int version = 1;

  /// The schema's absolute ceiling, independent of any roster limit.
  static const int maxDeclaredSize = 10485760;

  static const Set<String> _allowedFields = <String>{
    'version',
    'eventId',
    'senderDeviceId',
    'sessionId',
    'sequence',
    'createdAt',
    'contentType',
    'size',
    'hash',
    'payload',
  };

  static final RegExp _eventIdPattern = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  );
  static final RegExp _deviceIdPattern = RegExp(
    r'^cp_dev_[0-9a-hjkmnp-tv-z]{26}$',
  );
  static final RegExp _sessionIdPattern = RegExp(
    r'^cp_ses_[0-9a-hjkmnp-tv-z]{26}$',
  );
  static final RegExp _hashPattern = RegExp(r'^sha256:[0-9a-f]{64}$');

  /// Duplicated alongside `DateTime.parse` deliberately: the schema carries the
  /// same pattern next to `format: date-time` because a validator that ignores
  /// `format` must still reject a malformed timestamp — and `DateTime.parse` is
  /// considerably more forgiving than the contract.
  static final RegExp _timestampPattern = RegExp(
    r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$',
  );

  /// Standard base64, padded, no whitespace. Dart's decoder also accepts the
  /// URL-safe alphabet and tolerates oddities, so the shape is checked first.
  static final RegExp _base64Pattern = RegExp(
    r'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
  );

  final String eventId;
  final String senderDeviceId;
  final String? sessionId;
  final int sequence;
  final DateTime createdAt;
  final ContentType contentType;
  final int size;
  final String hash;
  final String payload;

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

  /// Builds an event for locally copied content, computing size and hash.
  factory ClipboardEvent.create({
    required String senderDeviceId,
    required int sequence,
    required ContentType contentType,
    required String payload,
    String? sessionId,
  }) {
    return ClipboardEvent(
      eventId: const Uuid().v4(),
      senderDeviceId: senderDeviceId,
      sessionId: sessionId,
      sequence: sequence,
      contentType: contentType,
      size: decodedBytes(payload, contentType).length,
      hash: computeHash(payload, contentType),
      payload: payload,
      createdAt: DateTime.now().toUtc(),
    );
  }

  /// Strictly decodes and validates an event received from a peer.
  ///
  /// Throws [EventRejectedException]. JSON Schema alone is not sufficient here:
  /// four of the contract's invalid vectors — hash mismatch, size mismatch,
  /// per-type limits and non-base64 image payloads — are *accepted* by the
  /// schema and can only be caught by the checks below.
  static ClipboardEvent decode(
    Map<String, dynamic> json, {
    PayloadLimits limits = const PayloadLimits(),
  }) {
    for (final key in json.keys) {
      if (!_allowedFields.contains(key)) {
        throw EventRejectedException(EventRejection.unknownField, key);
      }
    }

    if (json['version'] != version) {
      throw EventRejectedException(
        EventRejection.unsupportedVersion,
        '${json['version']}',
      );
    }

    final eventId = _requireString(json, 'eventId');
    if (!_eventIdPattern.hasMatch(eventId)) {
      throw const EventRejectedException(
        EventRejection.malformedEventId,
        'eventId',
      );
    }

    final senderDeviceId = _requireString(json, 'senderDeviceId');
    if (!_deviceIdPattern.hasMatch(senderDeviceId)) {
      // A sender id is an identity claim; accepting a loosely shaped one makes
      // every downstream comparison meaningless.
      throw const EventRejectedException(
        EventRejection.malformedSenderId,
        'senderDeviceId',
      );
    }

    final rawSessionId = json['sessionId'];
    String? sessionId;
    if (rawSessionId != null) {
      if (rawSessionId is! String ||
          !_sessionIdPattern.hasMatch(rawSessionId)) {
        throw const EventRejectedException(
          EventRejection.malformedSessionId,
          'sessionId',
        );
      }
      sessionId = rawSessionId;
    }

    final rawSequence = json['sequence'];
    if (rawSequence is! int ||
        rawSequence < 0 ||
        rawSequence > 9007199254740991) {
      throw EventRejectedException(EventRejection.badSequence, '$rawSequence');
    }

    final createdAtRaw = _requireString(json, 'createdAt');
    if (!_timestampPattern.hasMatch(createdAtRaw)) {
      throw const EventRejectedException(
        EventRejection.malformedTimestamp,
        'createdAt',
      );
    }
    final DateTime createdAt;
    try {
      createdAt = DateTime.parse(createdAtRaw);
    } on FormatException {
      throw const EventRejectedException(
        EventRejection.malformedTimestamp,
        'createdAt',
      );
    }

    final contentType = ContentType.fromMimeType(
      _requireString(json, 'contentType'),
    );
    if (contentType == null) {
      // Never coerce an unknown content type to text. MVP accepts three types
      // and must reject everything else outright.
      throw EventRejectedException(
        EventRejection.unsupportedContentType,
        '${json['contentType']}',
      );
    }

    final rawSize = json['size'];
    if (rawSize is! int || rawSize < 0 || rawSize > maxDeclaredSize) {
      throw EventRejectedException(EventRejection.sizeOutOfRange, '$rawSize');
    }

    final hash = _requireString(json, 'hash');
    if (!_hashPattern.hasMatch(hash)) {
      throw const EventRejectedException(EventRejection.malformedHash, 'hash');
    }

    final payload = _requireString(json, 'payload');

    // Semantic layer: everything below is invisible to JSON Schema.
    final List<int> decoded;
    try {
      decoded = decodedBytes(payload, contentType);
    } on FormatException catch (e) {
      throw EventRejectedException(EventRejection.payloadNotBase64, e.message);
    }

    if (decoded.length != rawSize) {
      throw EventRejectedException(
        EventRejection.sizeMismatch,
        'declared $rawSize, actual ${decoded.length}',
      );
    }

    final limit = limits.forContentType(contentType);
    if (rawSize > limit) {
      throw EventRejectedException(
        EventRejection.overTypeLimit,
        '$rawSize > $limit for ${contentType.mimeType}',
      );
    }

    if (_hashOf(decoded) != hash) {
      throw const EventRejectedException(
        EventRejection.hashMismatch,
        'hash does not match payload',
      );
    }

    return ClipboardEvent(
      eventId: eventId,
      senderDeviceId: senderDeviceId,
      sessionId: sessionId,
      sequence: rawSequence,
      contentType: contentType,
      size: rawSize,
      hash: hash,
      payload: payload,
      createdAt: createdAt,
    );
  }

  /// Convenience wrapper so existing call sites get the strict decoder.
  factory ClipboardEvent.fromJson(
    Map<String, dynamic> json, {
    PayloadLimits limits = const PayloadLimits(),
  }) => decode(json, limits: limits);

  static String _requireString(Map<String, dynamic> json, String field) {
    final value = json[field];
    if (value is! String) {
      throw EventRejectedException(EventRejection.missingField, field);
    }
    return value;
  }

  /// The bytes the hash and the declared size are both computed over.
  ///
  /// For images that is the *decoded* image, not its base64 text — hashing the
  /// encoding instead of the content is a silent interoperability break with
  /// any other implementation.
  static List<int> decodedBytes(String payload, ContentType contentType) {
    if (!contentType.isImage) return utf8.encode(payload);
    if (!_base64Pattern.hasMatch(payload)) {
      throw const FormatException('image payload is not standard base64');
    }
    return base64.decode(payload);
  }

  static String computeHash(String payload, ContentType contentType) =>
      _hashOf(decodedBytes(payload, contentType));

  static String _hashOf(List<int> bytes) => 'sha256:${sha256.convert(bytes)}';

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

  /// True when this event satisfies every contract rule under [limits].
  bool isValidUnder(PayloadLimits limits) {
    try {
      decode(toJson(), limits: limits);
      return true;
    } on EventRejectedException {
      return false;
    }
  }

  /// Retained for call sites that only know a single overall ceiling.
  bool isValid(int maxSizeBytes) {
    return isValidUnder(
      PayloadLimits(
        textPlain: maxSizeBytes < 1048576 ? maxSizeBytes : 1048576,
        imagePng: maxSizeBytes,
        imageJpeg: maxSizeBytes,
      ),
    );
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
