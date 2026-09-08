import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart' as crypt;
import 'api_client.dart';

class TokenPair {
  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;

  TokenPair({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  factory TokenPair.fromJson(Map<String, dynamic> json) {
    final accessToken = json['accessToken'] ?? json['access_token'];
    final refreshToken = json['refreshToken'] ?? json['refresh_token'];
    if (accessToken is! String || refreshToken is! String) {
      throw FormatException(
        'Token response is missing accessToken or refreshToken. '
        'Got keys: ${json.keys.join(', ')}',
      );
    }

    final expiresIn = json['expiresIn'] ?? json['expires_in'];
    final expiresAt = json['expiresAt'] ?? json['expires_at'];

    DateTime computedExpiresAt;
    if (expiresIn is num) {
      computedExpiresAt = DateTime.now().add(
        Duration(seconds: expiresIn.toInt()),
      );
    } else if (expiresAt is String) {
      computedExpiresAt = DateTime.parse(expiresAt);
    } else {
      // Default to 1 hour if neither field is present
      computedExpiresAt = DateTime.now().add(const Duration(hours: 1));
    }

    return TokenPair(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: computedExpiresAt,
    );
  }

  Map<String, dynamic> toJson() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'expiresAt': expiresAt.toIso8601String(),
  };

  bool get isExpired => DateTime.now().isAfter(expiresAt);
  bool get isValid => !isExpired;
}

class DeviceCredentials {
  final String deviceId;
  final String deviceName;
  final String publicKey;
  final String keyFingerprint; // SHA256 of public key, hex encoded
  final String privateKey; // Never sent to server
  final String platform;
  final String appVersion;
  final String protocolVersion;
  final bool syncEnabled;
  final bool revoked;
  final DateTime createdAt;
  int _sequenceNumber = 0; // Local counter for clipboard events

  DeviceCredentials({
    required this.deviceId,
    required this.deviceName,
    required this.publicKey,
    required this.keyFingerprint,
    required this.privateKey,
    required this.platform,
    required this.appVersion,
    required this.protocolVersion,
    this.syncEnabled = true,
    this.revoked = false,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  factory DeviceCredentials.fromJson(Map<String, dynamic> json) {
    return DeviceCredentials(
      deviceId: json['deviceId'] as String,
      deviceName: json['deviceName'] as String,
      publicKey: json['publicKey'] as String,
      keyFingerprint: json['keyFingerprint'] as String,
      privateKey: json['privateKey'] as String,
      platform: json['platform'] as String,
      appVersion: json['appVersion'] as String,
      protocolVersion: json['protocolVersion']?.toString() ?? '1',
      syncEnabled: json['syncEnabled'] as bool? ?? true,
      revoked: json['revoked'] as bool? ?? false,
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'deviceId': deviceId,
    'deviceName': deviceName,
    'publicKey': publicKey,
    'keyFingerprint': keyFingerprint,
    'privateKey': privateKey,
    'platform': platform,
    'appVersion': appVersion,
    'protocolVersion': protocolVersion,
    'syncEnabled': syncEnabled,
    'revoked': revoked,
    'createdAt': createdAt.toIso8601String(),
  };

  int getNextSequenceNumber() {
    return ++_sequenceNumber;
  }
}

abstract class AuthService {
  Future<TokenPair> login(String email, String password);
  Future<TokenPair> refresh();
  Future<void> logout();
  Future<TokenPair?> getStoredTokens();
  Future<void> saveTokens(TokenPair tokens);
  Future<DeviceCredentials> registerDevice(
    String pairingCode,
    String deviceName,
  );
  Future<DeviceCredentials?> getStoredDeviceCredentials();
  Future<void> saveDeviceCredentials(DeviceCredentials credentials);
  Future<void> clearAll();
}

class AuthServiceImpl implements AuthService {
  static const String _tokenKey = 'auth_tokens';
  static const String _deviceKey = 'device_credentials';
  static const String _refreshTokenKey = 'refresh_token_secure';

  final FlutterSecureStorage _secureStorage;
  final ApiClient _apiClient;
  String? _appVersion;

  TokenPair? _cachedTokens;

  AuthServiceImpl({
    required String apiBaseUrl,
    FlutterSecureStorage? secureStorage,
    ApiClient? apiClient,
  }) : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
       _apiClient = apiClient ?? ApiClient(baseUrl: apiBaseUrl) {
    _initAppVersion();
  }

  Future<void> _initAppVersion() async {
    try {
      final packageInfo = await PackageInfo.fromPlatform();
      _appVersion = packageInfo.version;
    } catch (e) {
      _appVersion = '1.0.0';
    }
  }

  @override
  Future<TokenPair> login(String email, String password) async {
    try {
      final response = await _apiClient.post('/auth/login', {
        'email': email,
        'password': password,
      }, withAuth: false);

      final tokens = TokenPair.fromJson(response);
      _apiClient.setBearerToken(tokens.accessToken);
      await saveTokens(tokens);
      _cachedTokens = tokens;
      return tokens;
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        throw Exception(
          'Invalid email or password. Please check and try again.',
        );
      } else if (e.statusCode == 422) {
        throw Exception(
          'Email format is invalid. Please check your email address.',
        );
      } else if (e.statusCode == 429) {
        throw Exception('Too many login attempts. Please try again later.');
      }
      throw Exception('Login error: ${e.message}');
    } on FormatException {
      throw Exception('Invalid login response from server. Please try again.');
    } catch (e) {
      throw Exception(
        'Login failed: Unable to connect to server. Check your internet connection.',
      );
    }
  }

  @override
  Future<TokenPair> refresh() async {
    try {
      final refreshToken = await _getRefreshToken();
      if (refreshToken == null) {
        await clearAll();
        throw Exception('Session expired. Please log in again.');
      }

      final response = await _apiClient.post('/auth/refresh', {
        'refreshToken': refreshToken,
      }, withAuth: false);

      final newTokens = TokenPair.fromJson(response);
      _apiClient.setBearerToken(newTokens.accessToken);
      await saveTokens(newTokens);
      _cachedTokens = newTokens;
      return newTokens;
    } on ApiException catch (e) {
      await clearAll();
      if (e.statusCode == 401) {
        throw Exception('Session expired. Please log in again.');
      }
      throw Exception('Unable to refresh session. Please log in again.');
    } catch (e) {
      await clearAll();
      throw Exception('Session refresh failed. Please log in again.');
    }
  }

  Future<String?> _getRefreshToken() async {
    try {
      final jsonStr = await _secureStorage.read(key: _tokenKey);
      if (jsonStr == null) return null;

      final json = jsonDecode(jsonStr) as Map<String, dynamic>;
      return json['refreshToken'] as String?;
    } catch (e) {
      return null;
    }
  }

  @override
  Future<void> logout() async {
    try {
      final tokens = await getStoredTokens();
      if (tokens != null) {
        await _apiClient.post('/auth/logout', {
          'refreshToken': tokens.refreshToken,
        }, withAuth: false);
      }
    } catch (e) {
      // Logout fails gracefully, still clear locally
    } finally {
      await clearAll();
    }
  }

  @override
  Future<TokenPair?> getStoredTokens() async {
    if (_cachedTokens != null && _cachedTokens!.isValid) {
      _apiClient.setBearerToken(_cachedTokens!.accessToken);
      return _cachedTokens;
    }

    try {
      final jsonStr = await _secureStorage.read(key: _tokenKey);
      if (jsonStr == null) return null;

      final json = jsonDecode(jsonStr) as Map<String, dynamic>;
      _cachedTokens = TokenPair.fromJson(json);

      if (_cachedTokens!.isExpired) {
        return null; // Return null if expired, let caller handle refresh
      }

      _apiClient.setBearerToken(_cachedTokens!.accessToken);
      return _cachedTokens;
    } catch (e) {
      return null;
    }
  }

  @override
  Future<void> saveTokens(TokenPair tokens) async {
    await _secureStorage.write(
      key: _tokenKey,
      value: jsonEncode(tokens.toJson()),
    );
    _cachedTokens = tokens;
  }

  @override
  Future<DeviceCredentials> registerDevice(
    String pairingCode,
    String deviceName,
  ) async {
    try {
      // Generate Ed25519 key pair
      final ed25519 = crypt.Ed25519();
      final keyPair = await ed25519.newKeyPair();
      final publicKey = await keyPair.extractPublicKey();
      final privateKeyBytes = await keyPair.extractPrivateKeyBytes();

      final publicKeyBytes = publicKey.bytes;
      final publicKeyBase64 = base64Encode(publicKeyBytes);
      final privateKeyBase64 = base64Encode(privateKeyBytes);

      // Key fingerprint: sha256:<hex of raw 32 bytes>
      final keyFingerprint = 'sha256:${sha256.convert(publicKeyBytes)}';

      final platform = Platform.isAndroid ? 'android' : 'ios';
      final appVersion = _appVersion ?? '1.0.0';
      const protocolVersion = 1;

      final response = await _apiClient.post('/devices', {
        'pairingCode': pairingCode
            .replaceAll(RegExp(r'[\s-]'), '')
            .trim()
            .toUpperCase(),
        'name': deviceName.trim(),
        'platform': platform,
        'appVersion': appVersion,
        'protocolVersion': protocolVersion,
        'publicKey': publicKeyBase64,
        'capabilities': {
          'contentTypes': ['text/plain', 'image/png', 'image/jpeg'],
        },
      }, withAuth: false);

      final deviceData =
          (response['device'] as Map<String, dynamic>?) ?? response;
      final deviceId =
          (deviceData['id'] ?? response['deviceId'] ?? '') as String;
      final returnedName =
          (deviceData['name'] ?? response['deviceName'] ?? deviceName)
              as String;
      final syncEnabled =
          (deviceData['syncEnabled'] ?? response['syncEnabled'] as bool?) ??
          true;
      final revoked =
          (deviceData['revoked'] ?? response['revoked'] as bool?) ?? false;
      final createdAtStr = deviceData['createdAt'] ?? response['createdAt'];

      final credentials = DeviceCredentials(
        deviceId: deviceId,
        deviceName: returnedName,
        publicKey: publicKeyBase64,
        keyFingerprint: keyFingerprint,
        privateKey: privateKeyBase64,
        platform: platform,
        appVersion: appVersion,
        protocolVersion: protocolVersion.toString(),
        syncEnabled: syncEnabled,
        revoked: revoked,
        createdAt: createdAtStr != null
            ? DateTime.parse(createdAtStr as String)
            : null,
      );

      // Save credentials tokens if present in response
      if (response['credentials'] != null) {
        final tokens = TokenPair.fromJson(
          response['credentials'] as Map<String, dynamic>,
        );
        _apiClient.setBearerToken(tokens.accessToken);
        await saveTokens(tokens);
      } else if (response['accessToken'] != null) {
        _apiClient.setBearerToken(response['accessToken'] as String);
      }

      await saveDeviceCredentials(credentials);
      return credentials;
    } on ApiException catch (e) {
      if (e.statusCode == 400) {
        throw Exception('Invalid pairing code. Please check and try again.');
      } else if (e.statusCode == 404) {
        throw Exception(
          'Pairing code not found or expired. Please request a new one.',
        );
      } else if (e.statusCode == 409) {
        throw Exception(
          'Device already registered. Please try a different device name.',
        );
      }
      throw Exception('Device registration failed: ${e.message}');
    } on FormatException {
      throw Exception('Invalid response from server. Please try again.');
    } catch (e) {
      throw Exception(
        'Device registration failed. Check your internet connection and try again.',
      );
    }
  }

  @override
  Future<DeviceCredentials?> getStoredDeviceCredentials() async {
    try {
      final jsonStr = await _secureStorage.read(key: _deviceKey);
      if (jsonStr == null) return null;

      final json = jsonDecode(jsonStr) as Map<String, dynamic>;
      return DeviceCredentials.fromJson(json);
    } catch (e) {
      return null;
    }
  }

  @override
  Future<void> saveDeviceCredentials(DeviceCredentials credentials) async {
    await _secureStorage.write(
      key: _deviceKey,
      value: jsonEncode(credentials.toJson()),
    );
  }

  @override
  Future<void> clearAll() async {
    await _secureStorage.delete(key: _tokenKey);
    await _secureStorage.delete(key: _deviceKey);
    await _secureStorage.delete(key: _refreshTokenKey);
    _cachedTokens = null;
  }
}
