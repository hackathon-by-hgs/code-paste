import 'api_client.dart';
import '../utils/secure_logging.dart';

abstract class SharingService {
  Future<List<ShareSession>> listSessions();
  Future<ShareSession> getSession(String sessionId);
  Future<ShareSession> createSession(CreateSessionRequest request);
  Future<void> joinSession(String sessionId);
  Future<void> leaveSession(String sessionId);
  Future<void> revokeMember(String sessionId, String deviceId);
  Future<void> expireSession(String sessionId);
}

class SharingServiceImpl implements SharingService {
  final ApiClient _apiClient;

  SharingServiceImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  @override
  Future<List<ShareSession>> listSessions() async {
    try {
      SecureLogging.logSyncEvent('Fetching share sessions');
      final response = await _apiClient.get('/share-sessions', withAuth: true);

      final sessions = response['sessions'] as List<dynamic>?;
      if (sessions == null) {
        SecureLogging.logSecurity(
          'invalid_sessions_response',
          'No sessions in response',
        );
        return [];
      }

      return sessions
          .map((s) => ShareSession.fromJson(s as Map<String, dynamic>))
          .toList();
    } catch (e) {
      SecureLogging.logError('list_sessions', e as Exception);
      rethrow;
    }
  }

  @override
  Future<ShareSession> getSession(String sessionId) async {
    try {
      SecureLogging.logSyncEvent('Fetching session: $sessionId');
      final response = await _apiClient.get(
        '/share-sessions/$sessionId',
        withAuth: true,
      );

      return ShareSession.fromJson(response);
    } catch (e) {
      SecureLogging.logError('get_session', e as Exception);
      rethrow;
    }
  }

  @override
  Future<ShareSession> createSession(CreateSessionRequest request) async {
    try {
      SecureLogging.logSyncEvent('Creating share session');
      final response = await _apiClient.post(
        '/share-sessions',
        request.toJson(),
        withAuth: true,
      );

      return ShareSession.fromJson(response);
    } catch (e) {
      SecureLogging.logError('create_session', e as Exception);
      rethrow;
    }
  }

  @override
  Future<void> joinSession(String sessionId) async {
    try {
      SecureLogging.logSyncEvent('Joining session: $sessionId');
      await _apiClient.post(
        '/share-sessions/$sessionId/join',
        {},
        withAuth: true,
      );
    } catch (e) {
      SecureLogging.logError('join_session', e as Exception);
      rethrow;
    }
  }

  @override
  Future<void> leaveSession(String sessionId) async {
    try {
      SecureLogging.logSyncEvent('Leaving session: $sessionId');
      await _apiClient.post(
        '/share-sessions/$sessionId/leave',
        {},
        withAuth: true,
      );
    } catch (e) {
      SecureLogging.logError('leave_session', e as Exception);
      rethrow;
    }
  }

  @override
  Future<void> revokeMember(String sessionId, String deviceId) async {
    try {
      SecureLogging.logSecurity(
        'revoke_member',
        'Revoking device from session: $sessionId',
      );
      await _apiClient.post('/share-sessions/$sessionId/revoke-member', {
        'deviceId': deviceId,
      }, withAuth: true);
    } catch (e) {
      SecureLogging.logError('revoke_member', e as Exception);
      rethrow;
    }
  }

  @override
  Future<void> expireSession(String sessionId) async {
    try {
      SecureLogging.logSecurity(
        'expire_session',
        'Expiring session: $sessionId',
      );
      await _apiClient.post(
        '/share-sessions/$sessionId/expire',
        {},
        withAuth: true,
      );
    } catch (e) {
      SecureLogging.logError('expire_session', e as Exception);
      rethrow;
    }
  }
}

class ShareSession {
  final String id;
  final String createdBy;
  final List<String> members;
  final DateTime createdAt;
  final DateTime expiresAt;
  final bool isActive;

  ShareSession({
    required this.id,
    required this.createdBy,
    required this.members,
    required this.createdAt,
    required this.expiresAt,
    required this.isActive,
  });

  factory ShareSession.fromJson(Map<String, dynamic> json) {
    return ShareSession(
      id: json['id'] as String,
      createdBy: json['createdBy'] as String,
      members: List<String>.from(json['members'] as List),
      createdAt: DateTime.parse(json['createdAt'] as String),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'createdBy': createdBy,
    'members': members,
    'createdAt': createdAt.toIso8601String(),
    'expiresAt': expiresAt.toIso8601String(),
    'isActive': isActive,
  };

  bool get isExpired => DateTime.now().isAfter(expiresAt);
}

class CreateSessionRequest {
  final String name;
  final Duration expiresIn;

  CreateSessionRequest({required this.name, Duration? expiresIn})
    : expiresIn = expiresIn ?? const Duration(hours: 1);

  Map<String, dynamic> toJson() => {
    'name': name,
    'expiresIn': expiresIn.inSeconds,
  };
}
