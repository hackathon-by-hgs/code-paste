class AppConstants {
  // Error messages
  static const String errorGeneric = 'Something went wrong. Please try again.';
  static const String errorNetwork =
      'Network error. Please check your connection.';
  static const String errorTimeout = 'Request timeout. Please try again.';

  // Success messages
  static const String successClipboardCopied = 'Copied to clipboard';
  static const String successDevicePaired = 'Device paired successfully';

  // Validation
  static const int minPasswordLength = 8;
  static const int maxRetries = 3;

  // Timing
  static const Duration splashDuration = Duration(seconds: 2);
  static const Duration animationDuration = Duration(milliseconds: 300);
}
