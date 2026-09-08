import 'api_client.dart';
import '../utils/secure_logging.dart';

abstract class DeviceManagementService {
  Future<List<Device>> listDevices();
  Future<Device> getDevice(String deviceId);
  Future<Device> registerDevice(DeviceRegistrationRequest request);
  Future<void> revokeDevice(String deviceId);
  Future<void> deleteDevice(String deviceId);
}

class DeviceManagementServiceImpl implements DeviceManagementService {
  final ApiClient _apiClient;

  DeviceManagementServiceImpl({required ApiClient apiClient})
    : _apiClient = apiClient;

  @override
  Future<List<Device>> listDevices() async {
    try {
      SecureLogging.logSyncEvent('Fetching devices list');
      final response = await _apiClient.get('/devices', withAuth: true);

      final devices = response['devices'] as List<dynamic>?;
      if (devices == null) {
        SecureLogging.logSecurity(
          'invalid_devices_response',
          'No devices in response',
        );
        return [];
      }

      return devices
          .map((d) => Device.fromJson(d as Map<String, dynamic>))
          .toList();
    } catch (e) {
      SecureLogging.logError('list_devices', e as Exception);
      rethrow;
    }
  }

  @override
  Future<Device> getDevice(String deviceId) async {
    try {
      SecureLogging.logSyncEvent('Fetching device: $deviceId');
      final response = await _apiClient.get(
        '/devices/$deviceId',
        withAuth: true,
      );

      return Device.fromJson(response);
    } catch (e) {
      SecureLogging.logError('get_device', e as Exception);
      rethrow;
    }
  }

  @override
  Future<Device> registerDevice(DeviceRegistrationRequest request) async {
    try {
      SecureLogging.logSyncEvent('Registering device: ${request.name}');
      final response = await _apiClient.post(
        '/devices',
        request.toJson(),
        withAuth: true,
      );

      return Device.fromJson(response);
    } catch (e) {
      SecureLogging.logError('register_device', e as Exception);
      rethrow;
    }
  }

  @override
  Future<void> revokeDevice(String deviceId) async {
    try {
      SecureLogging.logSecurity('revoke_device', 'Revoking device: $deviceId');
      await _apiClient.post('/devices/$deviceId/revoke', {}, withAuth: true);
    } catch (e) {
      SecureLogging.logError('revoke_device', e as Exception);
      rethrow;
    }
  }

  @override
  Future<void> deleteDevice(String deviceId) async {
    try {
      SecureLogging.logSecurity('delete_device', 'Deleting device: $deviceId');
      await _apiClient.delete('/devices/$deviceId', withAuth: true);
    } catch (e) {
      SecureLogging.logError('delete_device', e as Exception);
      rethrow;
    }
  }
}

class Device {
  final String id;
  final String name;
  final String platform;
  final String appVersion;
  final String protocolVersion;
  final String publicKeyFingerprint;
  final List<String> capabilities;
  final DateTime registeredAt;
  final DateTime? lastSeenAt;
  final bool isCurrentDevice;

  Device({
    required this.id,
    required this.name,
    required this.platform,
    required this.appVersion,
    required this.protocolVersion,
    required this.publicKeyFingerprint,
    required this.capabilities,
    required this.registeredAt,
    this.lastSeenAt,
    required this.isCurrentDevice,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    return Device(
      id: json['id'] as String,
      name: json['name'] as String,
      platform: json['platform'] as String,
      appVersion: json['appVersion'] as String,
      protocolVersion: json['protocolVersion'] as String,
      publicKeyFingerprint: json['publicKeyFingerprint'] as String,
      capabilities: List<String>.from(json['capabilities'] as List),
      registeredAt: DateTime.parse(json['registeredAt'] as String),
      lastSeenAt: json['lastSeenAt'] != null
          ? DateTime.parse(json['lastSeenAt'] as String)
          : null,
      isCurrentDevice: json['isCurrentDevice'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'platform': platform,
    'appVersion': appVersion,
    'protocolVersion': protocolVersion,
    'publicKeyFingerprint': publicKeyFingerprint,
    'capabilities': capabilities,
    'registeredAt': registeredAt.toIso8601String(),
    'lastSeenAt': lastSeenAt?.toIso8601String(),
    'isCurrentDevice': isCurrentDevice,
  };
}

class DeviceRegistrationRequest {
  final String name;
  final String platform;
  final String appVersion;
  final String protocolVersion;
  final String publicKey;
  final List<String> capabilities;

  DeviceRegistrationRequest({
    required this.name,
    required this.platform,
    required this.appVersion,
    required this.protocolVersion,
    required this.publicKey,
    required this.capabilities,
  });

  Map<String, dynamic> toJson() => {
    'name': name,
    'platform': platform,
    'appVersion': appVersion,
    'protocolVersion': protocolVersion,
    'publicKey': publicKey,
    'capabilities': capabilities,
  };
}
