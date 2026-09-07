class ProtocolPolicy {
  final int protocolVersion;
  final Map<String, int> payloadLimits; // contentType -> bytes
  final List<String> supportedContentTypes;

  ProtocolPolicy({
    required this.protocolVersion,
    required this.payloadLimits,
    required this.supportedContentTypes,
  });

  factory ProtocolPolicy.fromJson(Map<String, dynamic> json) {
    return ProtocolPolicy(
      protocolVersion: json['protocolVersion'] as int? ?? 1,
      payloadLimits: Map<String, int>.from(
        (json['limits'] as Map<String, dynamic>?)?.cast<String, int>() ??
            {
              'text/plain': 1048576, // 1 MiB
              'image/png': 10485760, // 10 MiB
              'image/jpeg': 10485760, // 10 MiB
            },
      ),
      supportedContentTypes: List<String>.from(
        (json['supportedContentTypes'] as List?)?.cast<String>() ??
            ['text/plain', 'image/png', 'image/jpeg'],
      ),
    );
  }

  int? getLimitForContentType(String contentType) {
    return payloadLimits[contentType];
  }

  bool isContentTypeSupported(String contentType) {
    return supportedContentTypes.contains(contentType);
  }
}
