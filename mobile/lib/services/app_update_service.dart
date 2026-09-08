import 'dart:io';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../utils/secure_logging.dart';
import 'api_client.dart';

class AppUpdate {
  final String version;
  final String buildNumber;
  final String releaseNotes;
  final String downloadUrl;
  final bool isCritical;
  final DateTime releaseDate;

  AppUpdate({
    required this.version,
    required this.buildNumber,
    required this.releaseNotes,
    required this.downloadUrl,
    required this.isCritical,
    required this.releaseDate,
  });

  factory AppUpdate.fromJson(Map<String, dynamic> json) {
    return AppUpdate(
      version: json['version'] as String,
      buildNumber: json['buildNumber'] as String,
      releaseNotes: json['releaseNotes'] as String,
      downloadUrl: json['downloadUrl'] as String,
      isCritical: json['isCritical'] as bool? ?? false,
      releaseDate: DateTime.parse(json['releaseDate'] as String),
    );
  }
}

abstract class AppUpdateService {
  Future<AppUpdate?> checkForUpdate();
  Future<bool> isUpdateAvailable();
  bool isNewerVersion(String currentVersion, String newVersion);
  Future<void> installUpdate(AppUpdate update);
}

class AppUpdateServiceImpl implements AppUpdateService {
  final ApiClient _apiClient;
  PackageInfo? _packageInfo;

  /// Demo mode: shows sample update for testing (disable when backend ready)
  static const bool demoMode = true;

  AppUpdateServiceImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  Future<PackageInfo> _getPackageInfo() async {
    if (_packageInfo == null) {
      _packageInfo = await PackageInfo.fromPlatform();
    }
    return _packageInfo!;
  }

  @override
  Future<AppUpdate?> checkForUpdate() async {
    try {
      final packageInfo = await _getPackageInfo();
      SecureLogging.logSyncEvent(
        'Checking for app updates. Current version: ${packageInfo.version}',
      );

      // Demo mode: show sample update for testing
      if (demoMode) {
        SecureLogging.logSyncEvent('Demo mode: showing sample update');
        return AppUpdate(
          version: '1.1.0',
          buildNumber: '2',
          releaseNotes: 'Bug fixes and performance improvements\n\n• Fixed clipboard sync issues\n• Improved peer discovery\n• Better error handling',
          downloadUrl: 'https://github.com/hackathon-by-hgs/code-paste/releases/download/v1.1.0/app-1.1.0.apk',
          isCritical: false,
          releaseDate: DateTime.now(),
        );
      }

      // Try to fetch from backend
      try {
        final response = await _apiClient.get('/app/update-check', withAuth: false);

        if (response['updateAvailable'] != true) {
          SecureLogging.logSyncEvent('App is up to date');
          return null;
        }

        final update = AppUpdate.fromJson(response['update'] as Map<String, dynamic>);

        if (isNewerVersion(packageInfo.version, update.version)) {
          SecureLogging.logSyncEvent('Update available: ${update.version}');
          return update;
        }

        return null;
      } catch (e) {
        // Backend endpoint not available yet - that's OK
        SecureLogging.logSyncEvent('Update check failed (backend not ready): $e');
        return null;
      }
    } catch (e) {
      SecureLogging.logError('app_update_check', e as Exception);
      return null;
    }
  }

  @override
  Future<bool> isUpdateAvailable() async {
    final update = await checkForUpdate();
    return update != null;
  }

  @override
  bool isNewerVersion(String currentVersion, String newVersion) {
    try {
      final current = _parseVersion(currentVersion);
      final newer = _parseVersion(newVersion);

      if (newer[0] > current[0]) return true;
      if (newer[0] < current[0]) return false;

      if (newer[1] > current[1]) return true;
      if (newer[1] < current[1]) return false;

      return newer[2] > current[2];
    } catch (e) {
      SecureLogging.logError('version_comparison', e as Exception);
      return false;
    }
  }

  List<int> _parseVersion(String version) {
    try {
      final parts = version.split('.');
      return [
        int.parse(parts[0]),
        parts.length > 1 ? int.parse(parts[1]) : 0,
        parts.length > 2 ? int.parse(parts[2]) : 0,
      ];
    } catch (e) {
      return [0, 0, 0];
    }
  }

  Future<void> installUpdate(AppUpdate update) async {
    try {
      if (Platform.isAndroid) {
        await _installAndroidUpdate(update);
      } else if (Platform.isIOS) {
        await _installIOSUpdate(update);
      }
    } catch (e) {
      SecureLogging.logError('app_update_install', e as Exception);
      rethrow;
    }
  }

  Future<void> _installAndroidUpdate(AppUpdate update) async {
    try {
      final uri = Uri.parse(update.downloadUrl);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        SecureLogging.logSyncEvent('Opened APK download: ${update.downloadUrl}');
      }
    } catch (e) {
      SecureLogging.logError('android_update_install', e as Exception);
      rethrow;
    }
  }

  Future<void> _installIOSUpdate(AppUpdate update) async {
    try {
      final appStoreUrl = Uri.parse(update.downloadUrl);
      if (await canLaunchUrl(appStoreUrl)) {
        await launchUrl(appStoreUrl, mode: LaunchMode.externalApplication);
        SecureLogging.logSyncEvent('Opened App Store: ${update.downloadUrl}');
      }
    } catch (e) {
      SecureLogging.logError('ios_update_install', e as Exception);
      rethrow;
    }
  }
}
