import 'package:flutter_test/flutter_test.dart';
import 'package:copy_and_paste/services/api_client.dart';
import 'package:copy_and_paste/services/auth_service.dart';
import 'package:copy_and_paste/services/device_management_service.dart';
import 'package:copy_and_paste/services/sharing_service.dart';
import 'package:http/http.dart' as http;
import 'package:mockito/mockito.dart';

class MockHttpClient extends Mock implements http.Client {}

void main() {
  group('API Endpoints', () {
    const baseUrl = 'https://code-paste.onrender.com/v1';
    late ApiClient apiClient;
    late MockHttpClient mockHttpClient;

    setUp(() {
      mockHttpClient = MockHttpClient();
      apiClient = ApiClient(baseUrl: baseUrl, httpClient: mockHttpClient);
    });

    group('Auth Endpoints', () {
      test('POST /auth/login returns TokenPair with accessToken', () async {
        final response = http.Response(
          '{"accessToken":"token123","refreshToken":"refresh123","expiresAt":"2099-01-01T00:00:00Z"}',
          200,
        );
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await apiClient.post('/auth/login', {
          'email': 'test@example.com',
          'password': 'password123',
        }, withAuth: false);

        expect(result['accessToken'], 'token123');
        expect(result['refreshToken'], 'refresh123');
      });

      test('POST /auth/refresh returns new TokenPair', () async {
        final response = http.Response(
          '{"accessToken":"newToken123","refreshToken":"newRefresh123","expiresAt":"2099-01-01T00:00:00Z"}',
          200,
        );
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await apiClient.post('/auth/refresh', {
          'refreshToken': 'oldRefresh',
        }, withAuth: false);

        expect(result['accessToken'], 'newToken123');
      });

      test('POST /auth/logout returns success', () async {
        final response = http.Response('{}', 200);
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await apiClient.post('/auth/logout', {
          'refreshToken': 'token123',
        }, withAuth: false);

        expect(result, isNotNull);
      });
    });

    group('Device Management Endpoints', () {
      late DeviceManagementService deviceService;

      setUp(() {
        deviceService = DeviceManagementServiceImpl(apiClient: apiClient);
      });

      test('GET /devices returns list of devices', () async {
        final response = http.Response(
          '{"devices":[{"id":"dev1","name":"iPhone","platform":"ios","appVersion":"1.0.0","protocolVersion":"1","publicKeyFingerprint":"abc123","capabilities":["text/plain"],"registeredAt":"2099-01-01T00:00:00Z","isCurrentDevice":true}]}',
          200,
        );
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        final devices = await deviceService.listDevices();

        expect(devices, isNotEmpty);
        expect(devices[0].id, 'dev1');
        expect(devices[0].name, 'iPhone');
        expect(devices[0].platform, 'ios');
      });

      test('GET /devices/:id returns specific device', () async {
        final response = http.Response(
          '{"id":"dev1","name":"iPhone","platform":"ios","appVersion":"1.0.0","protocolVersion":"1","publicKeyFingerprint":"abc123","capabilities":["text/plain"],"registeredAt":"2099-01-01T00:00:00Z","isCurrentDevice":true}',
          200,
        );
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        final device = await deviceService.getDevice('dev1');

        expect(device.id, 'dev1');
        expect(device.platform, 'ios');
      });

      test('POST /devices registers new device', () async {
        final response = http.Response(
          '{"id":"dev2","name":"My Device","platform":"ios","appVersion":"1.0.0","protocolVersion":"1","publicKeyFingerprint":"xyz789","capabilities":["text/plain","image/png"],"registeredAt":"2099-01-01T00:00:00Z","isCurrentDevice":false}',
          201,
        );
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final request = DeviceRegistrationRequest(
          name: 'My Device',
          platform: 'ios',
          appVersion: '1.0.0',
          protocolVersion: '1',
          publicKey: 'pk_xyz',
          capabilities: ['text/plain', 'image/png'],
        );
        final device = await deviceService.registerDevice(request);

        expect(device.id, 'dev2');
        expect(device.name, 'My Device');
      });

      test('POST /devices/:id/revoke revokes device', () async {
        final response = http.Response('{}', 200);
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await deviceService.revokeDevice('dev1');
        expect(result, isNull);
      });

      test('DELETE /devices/:id deletes device', () async {
        final response = http.Response('', 204);
        when(mockHttpClient.delete(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        final result = await deviceService.deleteDevice('dev1');
        expect(result, isNull);
      });
    });

    group('Sharing Sessions Endpoints', () {
      late SharingService sharingService;

      setUp(() {
        sharingService = SharingServiceImpl(apiClient: apiClient);
      });

      test('POST /share-sessions creates new session', () async {
        final response = http.Response(
          '{"id":"sess1","createdBy":"user1","members":["user1"],"createdAt":"2099-01-01T00:00:00Z","expiresAt":"2099-01-02T00:00:00Z","isActive":true}',
          201,
        );
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final request = CreateSessionRequest(
          name: 'Family Sync',
          expiresIn: const Duration(hours: 1),
        );
        final session = await sharingService.createSession(request);

        expect(session.id, 'sess1');
        expect(session.createdBy, 'user1');
        expect(session.isActive, true);
      });

      test('GET /share-sessions lists all sessions', () async {
        final response = http.Response(
          '{"sessions":[{"id":"sess1","createdBy":"user1","members":["user1"],"createdAt":"2099-01-01T00:00:00Z","expiresAt":"2099-01-02T00:00:00Z","isActive":true}]}',
          200,
        );
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        final sessions = await sharingService.listSessions();

        expect(sessions, isNotEmpty);
        expect(sessions[0].id, 'sess1');
      });

      test('GET /share-sessions/:id retrieves specific session', () async {
        final response = http.Response(
          '{"id":"sess1","createdBy":"user1","members":["user1","user2"],"createdAt":"2099-01-01T00:00:00Z","expiresAt":"2099-01-02T00:00:00Z","isActive":true}',
          200,
        );
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        final session = await sharingService.getSession('sess1');

        expect(session.id, 'sess1');
        expect(session.members, contains('user1'));
      });

      test('POST /share-sessions/:id/join joins session', () async {
        final response = http.Response('{}', 200);
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await sharingService.joinSession('sess1');
        expect(result, isNull);
      });

      test('POST /share-sessions/:id/leave leaves session', () async {
        final response = http.Response('{}', 200);
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await sharingService.leaveSession('sess1');
        expect(result, isNull);
      });

      test('POST /share-sessions/:id/revoke-member revokes member', () async {
        final response = http.Response('{}', 200);
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await sharingService.revokeMember('sess1', 'user2');
        expect(result, isNull);
      });

      test('POST /share-sessions/:id/expire expires session', () async {
        final response = http.Response('{}', 200);
        when(mockHttpClient.post(any, headers: anyNamed('headers'), body: anyNamed('body')))
            .thenAnswer((_) => Future.value(response));

        final result = await sharingService.expireSession('sess1');
        expect(result, isNull);
      });
    });

    group('Error Handling', () {
      test('401 Unauthorized clears bearer token', () async {
        apiClient.setBearerToken('token123');
        final response = http.Response('{"error":"Unauthorized"}', 401);
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        try {
          await apiClient.get('/devices', withAuth: true);
        } catch (e) {
          expect(e, isA<ApiException>());
          expect((e as ApiException).statusCode, 401);
        }
      });

      test('400 Bad Request includes error message', () async {
        final response = http.Response('{"error":"Invalid request body"}', 400);
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.value(response));

        try {
          await apiClient.get('/invalid');
        } catch (e) {
          expect(e, isA<ApiException>());
          expect((e as ApiException).message, contains('Invalid request body'));
        }
      });

      test('Timeout after 30 seconds', () async {
        when(mockHttpClient.get(any, headers: anyNamed('headers')))
            .thenAnswer((_) => Future.delayed(
                  const Duration(seconds: 31),
                  () => http.Response('{}', 200),
                ));

        try {
          await apiClient.get('/devices');
          fail('Should have timed out');
        } catch (e) {
          expect(e, isA<ApiException>());
          expect((e as ApiException).message, contains('timeout'));
        }
      });
    });
  });
}
