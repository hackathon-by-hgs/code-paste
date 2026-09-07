/// Device model representing a paired device
class Device {
  final String id;
  final String name;
  final String deviceType; // 'ios', 'android', 'desktop'
  final DateTime pairedAt;
  final bool isActive;
  final String publicKey;

  Device({
    required this.id,
    required this.name,
    required this.deviceType,
    required this.pairedAt,
    required this.isActive,
    required this.publicKey,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    return Device(
      id: json['id'] as String,
      name: json['name'] as String,
      deviceType: json['deviceType'] as String,
      pairedAt: DateTime.parse(json['pairedAt'] as String),
      isActive: json['isActive'] as bool,
      publicKey: json['publicKey'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'deviceType': deviceType,
      'pairedAt': pairedAt.toIso8601String(),
      'isActive': isActive,
      'publicKey': publicKey,
    };
  }
}
