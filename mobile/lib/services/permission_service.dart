import 'dart:developer' as developer;
import 'package:flutter/services.dart';

/// PermissionService
/// Handles platform-specific permission requests for iOS and Android
///
/// Required permissions for the app:
/// - Local Network (iOS 14+, Android 12+)
/// - Bluetooth (for peer discovery and connection)
/// - Notification (optional, for alerts)
///
/// Platform specifics:
/// - iOS: Uses NSLocalNetworkUsageDescription in Info.plist
/// - Android: Uses AndroidManifest.xml permissions + runtime permissions
abstract class PermissionService {
  Future<bool> requestLocalNetworkPermission();
  Future<bool> requestBluetoothPermission();
  Future<bool> requestNotificationPermission();
  Future<bool> hasAllRequiredPermissions();
}

class PermissionServiceImpl implements PermissionService {
  static const platform = MethodChannel('com.hgs.copypaste/permissions');

  @override
  Future<bool> requestLocalNetworkPermission() async {
    try {
      final bool result =
          await platform.invokeMethod<bool>('requestLocalNetworkPermission') ??
          false;
      return result;
    } catch (e) {
      developer.log('Error requesting local network permission: $e');
      return false;
    }
  }

  @override
  Future<bool> requestBluetoothPermission() async {
    try {
      final bool result =
          await platform.invokeMethod<bool>('requestBluetoothPermission') ??
          false;
      return result;
    } catch (e) {
      developer.log('Error requesting Bluetooth permission: $e');
      return false;
    }
  }

  @override
  Future<bool> requestNotificationPermission() async {
    try {
      final bool result =
          await platform.invokeMethod<bool>('requestNotificationPermission') ??
          false;
      return result;
    } catch (e) {
      developer.log('Error requesting notification permission: $e');
      return false;
    }
  }

  @override
  Future<bool> hasAllRequiredPermissions() async {
    try {
      // Request all required permissions in sequence
      final localNetwork = await requestLocalNetworkPermission();
      if (!localNetwork) return false;

      final bluetooth = await requestBluetoothPermission();
      if (!bluetooth) return false;

      return true;
    } catch (e) {
      developer.log('Error checking permissions: $e');
      return false;
    }
  }
}
