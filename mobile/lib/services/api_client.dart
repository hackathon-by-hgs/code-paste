import 'package:http/http.dart' as http;
import 'dart:convert';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final dynamic originalError;

  ApiException({
    required this.message,
    this.statusCode,
    this.originalError,
  });

  @override
  String toString() => 'ApiException: $message (HTTP $statusCode)';
}

class ApiClient {
  final String baseUrl;
  final http.Client _httpClient;
  String? _bearerToken;

  static const String _clientHeader = 'CodePaste/1.0.0';

  ApiClient({
    required this.baseUrl,
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client();

  void setBearerToken(String token) {
    _bearerToken = token;
  }

  void clearBearerToken() {
    _bearerToken = null;
  }

  Map<String, String> _getHeaders({bool withAuth = true}) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'X-CodePaste-Client': _clientHeader,
    };

    if (withAuth && _bearerToken != null) {
      headers['Authorization'] = 'Bearer $_bearerToken';
    }

    return headers;
  }

  Future<Map<String, dynamic>> get(
    String path, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient.get(
        url,
        headers: _getHeaders(withAuth: withAuth),
      ).timeout(
        const Duration(seconds: 30),
        onTimeout: () => throw ApiException(
          message: 'Request timeout',
        ),
      );

      return _handleResponse(response);
    } catch (e) {
      throw ApiException(
        message: 'GET $path failed: $e',
        originalError: e,
      );
    }
  }

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic>? body, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient.post(
        url,
        headers: _getHeaders(withAuth: withAuth),
        body: body != null ? jsonEncode(body) : null,
      ).timeout(
        const Duration(seconds: 30),
        onTimeout: () => throw ApiException(
          message: 'Request timeout',
        ),
      );

      return _handleResponse(response);
    } catch (e) {
      throw ApiException(
        message: 'POST $path failed: $e',
        originalError: e,
      );
    }
  }

  Future<Map<String, dynamic>> patch(
    String path,
    Map<String, dynamic> body, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient.patch(
        url,
        headers: _getHeaders(withAuth: withAuth),
        body: jsonEncode(body),
      ).timeout(
        const Duration(seconds: 30),
        onTimeout: () => throw ApiException(
          message: 'Request timeout',
        ),
      );

      return _handleResponse(response);
    } catch (e) {
      throw ApiException(
        message: 'PATCH $path failed: $e',
        originalError: e,
      );
    }
  }

  Future<Map<String, dynamic>> delete(
    String path, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient.delete(
        url,
        headers: _getHeaders(withAuth: withAuth),
      ).timeout(
        const Duration(seconds: 30),
        onTimeout: () => throw ApiException(
          message: 'Request timeout',
        ),
      );

      if (response.statusCode == 204) {
        return {}; // No content
      }

      return _handleResponse(response);
    } catch (e) {
      throw ApiException(
        message: 'DELETE $path failed: $e',
        originalError: e,
      );
    }
  }

  Map<String, dynamic> _handleResponse(http.Response response) {
    try {
      final body = response.body.isEmpty
          ? <String, dynamic>{}
          : (jsonDecode(response.body) as Map<dynamic, dynamic>)
              .cast<String, dynamic>();

      switch (response.statusCode) {
        case 200:
        case 201:
        case 204:
          return body;
        case 400:
          throw ApiException(
            message: body['error'] ?? 'Bad request',
            statusCode: response.statusCode,
          );
        case 401:
          clearBearerToken();
          throw ApiException(
            message: body['error'] ?? 'Unauthorized',
            statusCode: response.statusCode,
          );
        case 409:
          throw ApiException(
            message: body['error'] ?? 'Conflict',
            statusCode: response.statusCode,
          );
        case 422:
          throw ApiException(
            message: body['error'] ?? 'Unprocessable entity',
            statusCode: response.statusCode,
          );
        case 429:
          throw ApiException(
            message: 'Too many requests. Try again later.',
            statusCode: response.statusCode,
          );
        default:
          throw ApiException(
            message: 'HTTP ${response.statusCode}: ${body['error'] ?? 'Unknown error'}',
            statusCode: response.statusCode,
          );
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException(
        message: 'Failed to parse response: $e',
        originalError: e,
      );
    }
  }
}
