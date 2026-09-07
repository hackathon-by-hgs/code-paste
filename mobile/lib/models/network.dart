enum ConnectionStatus {
  connected,
  available,
  unavailable,
}

enum SignalStrength {
  poor,
  fair,
  good,
  excellent,
}

class Network {
  final String id;
  final String name;
  final ConnectionStatus status;
  final SignalStrength signalStrength;
  final bool isCurrentlyConnected;

  Network({
    required this.id,
    required this.name,
    required this.status,
    required this.signalStrength,
    required this.isCurrentlyConnected,
  });

  String getSignalLabel() {
    switch (signalStrength) {
      case SignalStrength.poor:
        return 'Poor';
      case SignalStrength.fair:
        return 'Fair';
      case SignalStrength.good:
        return 'Good';
      case SignalStrength.excellent:
        return 'Excellent';
    }
  }

  int getSignalBars() {
    switch (signalStrength) {
      case SignalStrength.poor:
        return 1;
      case SignalStrength.fair:
        return 2;
      case SignalStrength.good:
        return 3;
      case SignalStrength.excellent:
        return 4;
    }
  }
}
