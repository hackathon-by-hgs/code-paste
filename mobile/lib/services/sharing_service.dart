import 'api_client.dart';
import '../utils/secure_logging.dart';

abstract class SharingService {
  Future<List<ShareSession>> listSessions({String? status});
  Future<ShareSession> getSession(String sessionId);
  Future<ShareSession> createSession([CreateSessionRequest? request]);
  Future<ShareSession> joinSession(String sessionId, String joinCode);
  Future<void> leaveSession(String sessionId);
  Future<ShareSession> revokeMember(String sessionId, String userId);
  Future<ShareSession> expireSession(String sessionId);
}

class SharingServiceImpl implements SharingService {
  final ApiClient _apiClient;

  SharingServiceImpl({required ApiClient apiClient}) : _apiClient = apiClient;

  @override
  Future<List<ShareSession>> listSessions({String? status}) async {
    try {
      SecureLogging.logSyncEvent('Fetching share sessions');
      final path = status != null ? '/share-sessions?status=$status' : '/share-sessions';
      final response = await _apiClient.get(path, withAuth: true);

      final rawList = response['data'] ?? response['sessions'];
      if (rawList is! List) {
        return [];
      }

      return rawList
          .whereType<Map<String, dynamic>>()
          .map((s) => ShareSession.fromJson(s))
          .toList();
    } catch (e) {
      SecureLogging.logError('list_sessions', e is Exception ? e : Exception(e.toString()));
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
      SecureLogging.logError('get_session', e is Exception ? e : Exception(e.toString()));
      rethrow;
    }
  }

  @override
  Future<ShareSession> createSession([CreateSessionRequest? request]) async {
    try {
      SecureLogging.logSyncEvent('Creating share session');
      final body = (request ?? CreateSessionRequest()).toJson();
      final response = await _apiClient.post(
        '/share-sessions',
        body,
        withAuth: true,
      );

      return ShareSession.fromJson(response);
    } catch (e) {
      SecureLogging.logError('create_session', e is Exception ? e : Exception(e.toString()));
      rethrow;
    }
  }

  @override
  Future<ShareSession> joinSession(String sessionId, String joinCode) async {
    try {
      SecureLogging.logSyncEvent('Joining session: $sessionId');
      final sanitizedCode = joinCode.replaceAll(RegExp(r'[\s-]'), '').toUpperCase();
      final response = await _apiClient.post(
        '/share-sessions/$sessionId/join',
        {'joinCode': sanitizedCode},
        withAuth: true,
      );
      return ShareSession.fromJson(response);
    } catch (e) {
      SecureLogging.logError('join_session', e is Exception ? e : Exception(e.toString()));
      rethrow;
    }
  }

  @override
  Future<void> leaveSession(String sessionId) async {
    try {
      SecureLogging.logSyncEvent('Leaving session: $sessionId');
      await _apiClient.post(
        '/share-sessions/$sessionId/leave',
        null,
        withAuth: true,
      );
    } catch (e) {
      SecureLogging.logError('leave_session', e is Exception ? e : Exception(e.toString()));
      rethrow;
    }
  }

  @override
  Future<ShareSession> revokeMember(String sessionId, String userId) async {
    try {
      SecureLogging.logSecurity(
        'revoke_member',
        'Revoking user from session: $sessionId',
      );
      final response = await _apiClient.post(
        '/share-sessions/$sessionId/revoke-member',
        {'userId': userId},
        withAuth: true,
      );
      return ShareSession.fromJson(response);
    } catch (e) {
      SecureLogging.logError('revoke_member', e is Exception ? e : Exception(e.toString()));
      rethrow;
    }
  }

  @override
  Future<ShareSession> expireSession(String sessionId) async {
    try {
      SecureLogging.logSecurity(
        'expire_session',
        'Expiring session: $sessionId',
      );
      final response = await _apiClient.post(
        '/share-sessions/$sessionId/expire',
        null,
        withAuth: true,
      );
      return ShareSession.fromJson(response);
    } catch (e) {
      SecureLogging.logError('expire_session', e is Exception ? e : Exception(e.toString()));
      rethrow;
    }
  }
}

class ShareMember {
  final String userId;
  final String email;
  final String role; // 'owner' or 'member'
  final DateTime joinedAt;
  final bool revoked;
  final DateTime? revokedAt;

  ShareMember({
    required this.userId,
    required this.email,
    required this.role,
    required this.joinedAt,
    required this.revoked,
    this.revokedAt,
  });

  bool get isOwner => role == 'owner';

  factory ShareMember.fromJson(Map<String, dynamic> json) {
    return ShareMember(
      userId: (json['userId'] ?? '') as String,
      email: (json['email'] ?? '') as String,
      role: (json['role'] ?? 'member') as String,
      joinedAt: json['joinedAt'] != null
          ? DateTime.parse(json['joinedAt'] as String)
          : DateTime.now(),
      revoked: json['revoked'] as bool? ?? false,
      revokedAt: json['revokedAt'] != null
          ? DateTime.parse(json['revokedAt'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'userId': userId,
    'email': email,
    'role': role,
    'joinedAt': joinedAt.toIso8601String(),
    'revoked': revoked,
    if (revokedAt != null) 'revokedAt': revokedAt!.toIso8601String(),
  };
}

class ShareSession {
  final String id;
  final String ownerUserId;
  final String status; // 'active', 'expired', 'revoked'
  final DateTime expiresAt;
  final DateTime createdAt;
  final List<ShareMember> members;
  final String? joinCode;

  ShareSession({
    required this.id,
    required this.ownerUserId,
    required this.status,
    required this.expiresAt,
    required this.createdAt,
    required this.members,
    this.joinCode,
  });

  bool get isActive => status == 'active' && !isExpired;
  bool get isExpired => DateTime.now().isAfter(expiresAt);

  factory ShareSession.fromJson(Map<String, dynamic> json) {
    final rawMembers = json['members'];
    final membersList = <ShareMember>[];
    if (rawMembers is List) {
      for (final m in rawMembers) {
        if (m is Map<String, dynamic>) {
          membersList.add(ShareMember.fromJson(m));
        } else if (m is Map) {
          membersList.add(ShareMember.fromJson(m.cast<String, dynamic>()));
        }
      }
    }

    return ShareSession(
      id: (json['id'] ?? '') as String,
      ownerUserId: (json['ownerUserId'] ?? json['createdBy'] ?? '') as String,
      status: (json['status'] ?? (json['isActive'] == false ? 'expired' : 'active')) as String,
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : DateTime.now().add(const Duration(hours: 1)),
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'] as String)
          : DateTime.now(),
      members: membersList,
      joinCode: json['joinCode'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'ownerUserId': ownerUserId,
    'status': status,
    'expiresAt': expiresAt.toIso8601String(),
    'createdAt': createdAt.toIso8601String(),
    'members': members.map((m) => m.toJson()).toList(),
    if (joinCode != null) 'joinCode': joinCode,
  };
}

class CreateSessionRequest {
  final int expiresInSeconds;

  CreateSessionRequest({int? expiresInSeconds, Duration? expiresIn})
      : expiresInSeconds = expiresInSeconds ?? expiresIn?.inSeconds ?? 3600;

  Map<String, dynamic> toJson() => {
    'expiresInSeconds': expiresInSeconds,
  };
}
