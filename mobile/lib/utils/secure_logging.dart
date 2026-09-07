import 'dart:developer' as developer;
import '../models/clipboard_event.dart';

/// Secure logging that never exposes clipboard contents or sensitive data
class SecureLogging {
  static const String _tag = 'copypaste';

  /// Log clipboard event metadata without payload
  static void logClipboardEvent(
    String message,
    ClipboardEvent event, {
    String level = 'info',
  }) {
    developer.log(
      '$message [eventId=${event.eventId.substring(0, 8)}... size=${event.size} type=${event.contentType.mimeType}]',
      name: _tag,
      level: _mapLevel(level),
    );
  }

  /// Log device sync status without leaking data
  static void logSyncEvent(String message) {
    developer.log(message, name: _tag);
  }

  /// Log transport events
  static void logTransport(String message) {
    developer.log(message, name: _tag);
  }

  /// Log security events
  static void logSecurity(String event, String reason) {
    developer.log('SECURITY: $event - $reason', name: _tag, level: 1000);
  }

  /// Log error without exposing sensitive details
  static void logError(String context, Exception e) {
    // Only log error type and message, never the full stack for sensitive context
    developer.log(
      'ERROR in $context: ${e.runtimeType}',
      name: _tag,
      level: 1000,
    );
  }

  static int _mapLevel(String level) {
    switch (level) {
      case 'debug':
        return 0;
      case 'info':
        return 800;
      case 'warning':
        return 900;
      case 'error':
        return 1000;
      default:
        return 800;
    }
  }
}
