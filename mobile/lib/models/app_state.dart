enum AppLifecycleState {
  initializing,
  permissionRequired,
  ready,
  activating,
  active,
  scanning,
  connecting,
  connected,
  connectionFailed,
  deactivating,
  error,
}

enum PermissionStatus {
  notRequested,
  granted,
  denied,
  permanentlyDenied,
}

class AppError {
  final String message;
  final String? details;
  final bool recoverable;

  AppError({
    required this.message,
    this.details,
    this.recoverable = true,
  });
}
