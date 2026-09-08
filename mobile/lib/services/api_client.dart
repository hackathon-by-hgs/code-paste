import 'package:http/http.dart' as http;
import 'dart:convert';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final dynamic originalError;

  ApiException({required this.message, this.statusCode, this.originalError});

  @override
  String toString() => 'ApiException: $message (HTTP $statusCode)';
}

class ApiClient {
  final String baseUrl;
  final http.Client _httpClient;
  String? _bearerToken;

  static const String _clientHeader = 'CodePaste/1.0.0';

  ApiClient({required this.baseUrl, http.Client? httpClient})
    : _httpClient = httpClient ?? http.Client();

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

  Future<Map<String, dynamic>> get(String path, {bool withAuth = true}) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient
          .get(url, headers: _getHeaders(withAuth: withAuth))
          .timeout(
            const Duration(seconds: 30),
            onTimeout: () => throw ApiException(message: 'Request timeout'),
          );

      return _handleResponse(response, withAuth: withAuth);
    } catch (e) {
      throw ApiException(message: 'GET $path failed: $e', originalError: e);
    }
  }

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic>? body, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient
          .post(
            url,
            headers: _getHeaders(withAuth: withAuth),
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(
            const Duration(seconds: 30),
            onTimeout: () => throw ApiException(message: 'Request timeout'),
          );

      return _handleResponse(response, withAuth: withAuth);
    } catch (e) {
      throw ApiException(message: 'POST $path failed: $e', originalError: e);
    }
  }

  Future<Map<String, dynamic>> patch(
    String path,
    Map<String, dynamic> body, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient
          .patch(
            url,
            headers: _getHeaders(withAuth: withAuth),
            body: jsonEncode(body),
          )
          .timeout(
            const Duration(seconds: 30),
            onTimeout: () => throw ApiException(message: 'Request timeout'),
          );

      return _handleResponse(response, withAuth: withAuth);
    } catch (e) {
      throw ApiException(message: 'PATCH $path failed: $e', originalError: e);
    }
  }

  Future<Map<String, dynamic>> delete(
    String path, {
    bool withAuth = true,
  }) async {
    try {
      final url = Uri.parse('$baseUrl$path');
      final response = await _httpClient
          .delete(url, headers: _getHeaders(withAuth: withAuth))
          .timeout(
            const Duration(seconds: 30),
            onTimeout: () => throw ApiException(message: 'Request timeout'),
          );

      if (response.statusCode == 204) {
        return {}; // No content
      }

      return _handleResponse(response, withAuth: withAuth);
    } catch (e) {
      throw ApiException(message: 'DELETE $path failed: $e', originalError: e);
    }
  }

  String _extractErrorMessage(Map<String, dynamic> body, String fallback) {
    final error = body['error'];
    if (error is String) return error;
    if (error is Map<String, dynamic>) {
      final msg = error['message'];
      final details = error['details'];
      if (details is List && details.isNotEmpty) {
        final detailsStr = details
            .map((d) {
              if (d is Map) {
                final path = d['path'] ?? '';
                final m = d['message'] ?? '';
                return path.toString().isNotEmpty ? '$path: $m' : m.toString();
              }
              return d.toString();
            })
            .join(', ');
        return msg != null ? '$msg ($detailsStr)' : detailsStr;
      }
      if (msg is String) return msg;
    }
    return fallback;
  }

  Map<String, dynamic> _handleResponse(
    http.Response response, {
    bool withAuth = true,
  }) {
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
            message: _extractErrorMessage(
              body,
              'Invalid request. Please check your input.',
            ),
            statusCode: response.statusCode,
          );
        case 401:
          if (withAuth) {
            clearBearerToken();
          }
          throw ApiException(
            message: _extractErrorMessage(
              body,
              'Session expired. Please log in again.',
            ),
            statusCode: response.statusCode,
          );
        case 409:
          throw ApiException(
            message: _extractErrorMessage(
              body,
              'This resource already exists.',
            ),
            statusCode: response.statusCode,
          );
        case 422:
          throw ApiException(
            message: _extractErrorMessage(
              body,
              'Invalid data. Please check your input.',
            ),
            statusCode: response.statusCode,
          );
        case 429:
          throw ApiException(
            message: 'Too many requests. Please wait and try again.',
            statusCode: response.statusCode,
          );
        case 500:
        case 502:
        case 503:
        case 504:
          throw ApiException(
            message: 'Server error. Please try again later.',
            statusCode: response.statusCode,
          );
        default:
          throw ApiException(
            message: _extractErrorMessage(
              body,
              'An error occurred. Please try again.',
            ),
            statusCode: response.statusCode,
          );
      }
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException(
        message:
            'Unable to process response. Please check your connection and try again.',
        originalError: e,
      );
    }
  }
}
