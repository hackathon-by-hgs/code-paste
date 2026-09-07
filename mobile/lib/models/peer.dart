class Peer {
  final String deviceId;
  final String userId;
  final String publicKey;
  final String keyFingerprint;
  final String platform;
  final int protocolVersion;
  final List<String> capabilities;
  final String scope; // 'personal' or 'session'
  final String? sessionId; // non-null if scope is 'session'

  Peer({
    required this.deviceId,
    required this.userId,
    required this.publicKey,
    required this.keyFingerprint,
    required this.platform,
    required this.protocolVersion,
    required this.capabilities,
    required this.scope,
    this.sessionId,
  });

  factory Peer.fromJson(Map<String, dynamic> json) {
    return Peer(
      deviceId: json['deviceId'] as String,
      userId: json['userId'] as String,
      publicKey: json['publicKey'] as String,
      keyFingerprint: json['keyFingerprint'] as String,
      platform: json['platform'] as String,
      protocolVersion: json['protocolVersion'] as int,
      capabilities: List<String>.from(
        (json['capabilities'] as List<dynamic>).cast<String>(),
      ),
      scope: json['scope'] as String,
      sessionId: json['sessionId'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'deviceId': deviceId,
    'userId': userId,
    'publicKey': publicKey,
    'keyFingerprint': keyFingerprint,
    'platform': platform,
    'protocolVersion': protocolVersion,
    'capabilities': capabilities,
    'scope': scope,
    'sessionId': sessionId,
  };

  bool supportsContentType(String contentType) {
    return capabilities.contains(contentType);
  }
}

class PeerSelf {
  final String deviceId;
  final String userId;
  final String keyFingerprint;

  PeerSelf({
    required this.deviceId,
    required this.userId,
    required this.keyFingerprint,
  });

  factory PeerSelf.fromJson(Map<String, dynamic> json) {
    return PeerSelf(
      deviceId: json['deviceId'] as String,
      userId: json['userId'] as String,
      keyFingerprint: json['keyFingerprint'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
    'deviceId': deviceId,
    'userId': userId,
    'keyFingerprint': keyFingerprint,
  };
}

class PeerRoster {
  final int protocolVersion;
  final int rosterVersion;
  final DateTime issuedAt;
  final DateTime expiresAt;
  final PeerSelf self;
  final List<Peer> peers;
  final Map<String, int> payloadLimits;

  PeerRoster({
    required this.protocolVersion,
    required this.rosterVersion,
    required this.issuedAt,
    required this.expiresAt,
    required this.self,
    required this.peers,
    required this.payloadLimits,
  });

  factory PeerRoster.fromJson(Map<String, dynamic> json) {
    return PeerRoster(
      protocolVersion: json['protocolVersion'] as int,
      rosterVersion: json['rosterVersion'] as int,
      issuedAt: DateTime.parse(json['issuedAt'] as String),
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      self: PeerSelf.fromJson(json['self'] as Map<String, dynamic>),
      peers: (json['peers'] as List<dynamic>)
          .map((p) => Peer.fromJson(p as Map<String, dynamic>))
          .toList(),
      payloadLimits: Map<String, int>.from(
        (json['limits'] as Map<String, dynamic>).cast<String, int>(),
      ),
    );
  }

  Map<String, dynamic> toJson() => {
    'protocolVersion': protocolVersion,
    'rosterVersion': rosterVersion,
    'issuedAt': issuedAt.toIso8601String(),
    'expiresAt': expiresAt.toIso8601String(),
    'self': self.toJson(),
    'peers': peers.map((p) => p.toJson()).toList(),
    'limits': payloadLimits,
  };

  bool isExpired() {
    return DateTime.now().isAfter(expiresAt);
  }

  Peer? findPeerByDeviceId(String deviceId) {
    try {
      return peers.firstWhere((p) => p.deviceId == deviceId);
    } catch (e) {
      return null;
    }
  }

  Peer? findPeerByFingerprint(String fingerprint) {
    try {
      return peers.firstWhere((p) => p.keyFingerprint == fingerprint);
    } catch (e) {
      return null;
    }
  }
}

class SignedPeerRoster {
  final String payload; // base64
  final String signatureAlgorithm; // 'ed25519'
  final String signatureKeyId;
  final String signatureValue; // base64

  SignedPeerRoster({
    required this.payload,
    required this.signatureAlgorithm,
    required this.signatureKeyId,
    required this.signatureValue,
  });

  factory SignedPeerRoster.fromJson(Map<String, dynamic> json) {
    final signature = json['signature'] as Map<String, dynamic>;
    return SignedPeerRoster(
      payload: json['payload'] as String,
      signatureAlgorithm: signature['algorithm'] as String,
      signatureKeyId: signature['keyId'] as String,
      signatureValue: signature['value'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
    'payload': payload,
    'signature': {
      'algorithm': signatureAlgorithm,
      'keyId': signatureKeyId,
      'value': signatureValue,
    },
  };
}
