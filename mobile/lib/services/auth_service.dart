import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pointycastle/export.dart';
import 'package:pointycastle/random/fortuna_random.dart';
import 'dart:convert';
import 'dart:math' show Random;
import 'dart:typed_data';
import 'dart:io' show Platform;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:crypto/crypto.dart';
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
    return TokenPair(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
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
      protocolVersion: json['protocolVersion'] as String,
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
  })  : _secureStorage = secureStorage ?? const FlutterSecureStorage(),
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
      final response = await _apiClient.post(
        '/auth/login',
        {
          'email': email,
          'password': password,
        },
        withAuth: false,
      );

      final tokens = TokenPair.fromJson(response);
      _apiClient.setBearerToken(tokens.accessToken);
      await saveTokens(tokens);
      _cachedTokens = tokens;
      return tokens;
    } catch (e) {
      throw Exception('Login failed: $e');
    }
  }

  @override
  Future<TokenPair> refresh() async {
    try {
      final storedTokens = await getStoredTokens();
      if (storedTokens == null) {
        throw Exception('No refresh token available');
      }

      final response = await _apiClient.post(
        '/auth/refresh',
        {
          'refreshToken': storedTokens.refreshToken,
        },
        withAuth: false,
      );

      final newTokens = TokenPair.fromJson(response);
      _apiClient.setBearerToken(newTokens.accessToken);
      await saveTokens(newTokens);
      _cachedTokens = newTokens;
      return newTokens;
    } catch (e) {
      await clearAll();
      throw Exception('Token refresh failed: $e');
    }
  }

  @override
  Future<void> logout() async {
    try {
      final tokens = await getStoredTokens();
      if (tokens != null) {
        await _apiClient.post(
          '/auth/logout',
          {
            'refreshToken': tokens.refreshToken,
          },
          withAuth: false,
        );
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
      // Generate RSA key pair
      final keyPair = _generateKeyPair();
      final publicKeyPem = _encodePublicKey(keyPair.publicKey);
      final privateKeyPem = _encodePrivateKey(keyPair.privateKey);

      // Calculate key fingerprint (SHA256 hex)
      final keyFingerprint = sha256.convert(utf8.encode(publicKeyPem)).toString();

      final platform = Platform.isAndroid ? 'android' : 'ios';
      final appVersion = _appVersion ?? '1.0.0';
      const protocolVersion = '1';

      final response = await _apiClient.post(
        '/devices',
        {
          'pairingCode': pairingCode,
          'deviceName': deviceName,
          'platform': platform,
          'appVersion': appVersion,
          'protocolVersion': protocolVersion,
          'publicKey': publicKeyPem,
          'capabilities': ['text/plain', 'image/png', 'image/jpeg'],
        },
        withAuth: false,
      );

      final credentials = DeviceCredentials(
        deviceId: response['deviceId'] as String,
        deviceName: response['deviceName'] as String? ?? deviceName,
        publicKey: publicKeyPem,
        keyFingerprint: keyFingerprint,
        privateKey: privateKeyPem,
        platform: platform,
        appVersion: appVersion,
        protocolVersion: protocolVersion,
        syncEnabled: response['syncEnabled'] as bool? ?? true,
        revoked: response['revoked'] as bool? ?? false,
        createdAt: response['createdAt'] != null
            ? DateTime.parse(response['createdAt'] as String)
            : null,
      );

      // Set bearer token from device registration response
      if (response['accessToken'] != null) {
        _apiClient.setBearerToken(response['accessToken'] as String);
      }

      await saveDeviceCredentials(credentials);
      return credentials;
    } catch (e) {
      throw Exception('Device registration failed: $e');
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

  // Generate RSA-2048 key pair
  AsymmetricKeyPair<RSAPublicKey, RSAPrivateKey> _generateKeyPair() {
    final generator = RSAKeyGenerator()
      ..init(
        ParametersWithRandom(
          RSAKeyGeneratorParameters(BigInt.from(65537), 2048, 64),
          FortunaRandom()..seed(KeyParameter(_getRandomBytes(32))),
        ),
      );
    return generator.generateKeyPair();
  }

  Uint8List _getRandomBytes(int count) {
    final random = Random();
    final bytes = List<int>.generate(count, (_) => random.nextInt(256));
    return Uint8List.fromList(bytes);
  }

  String _encodePublicKey(RSAPublicKey key) {
    // TODO: Proper PEM encoding of RSA public key
    return 'mock_public_key_${key.modulus}';
  }

  String _encodePrivateKey(RSAPrivateKey key) {
    // TODO: Proper PEM encoding of RSA private key
    return 'mock_private_key_${key.privateExponent}';
  }
}
