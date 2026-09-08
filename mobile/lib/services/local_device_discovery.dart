import 'dart:async';
import 'dart:math';
import '../models/network.dart';

/// LocalDeviceDiscovery
/// Handles local network device discovery via mDNS/Bonjour
/// For MVP, simulates discovery; future: real mDNS implementation
abstract class LocalDeviceDiscovery {
  Future<List<Network>> discoverDevices();
  Stream<Network> get discoveryStream;
  Future<void> stopDiscovery();
  void dispose();
}

class LocalDeviceDiscoveryImpl implements LocalDeviceDiscovery {
  final _discoveryStreamController = StreamController<Network>.broadcast();
  Timer? _scanTimer;
  final List<Network> _discoveredDevices = [];

  @override
  Stream<Network> get discoveryStream => _discoveryStreamController.stream;

  @override
  Future<List<Network>> discoverDevices() async {
    _discoveredDevices.clear();

    // Real mDNS discovery requires platform channels:
    // - iOS: NSNetServiceBrowser + NSNetService
    // - Android: NsdManager
    // Currently returns empty - peer roster from backend is authoritative

    return _discoveredDevices;
  }

  @override
  Future<void> stopDiscovery() async {
    _scanTimer?.cancel();
    _scanTimer = null;
  }

  Network? _generateMockDevice() {
    // Simulate random device discovery
    final random = Random();
    if (random.nextDouble() < 0.3) {
      // 30% chance to discover a device
      final devices = [
        Network(
          id: 'device-001',
          name: 'MacBook Pro',
          status: ConnectionStatus.available,
          signalStrength: SignalStrength.excellent,
          isCurrentlyConnected: false,
        ),
        Network(
          id: 'device-002',
          name: 'iMac',
          status: ConnectionStatus.available,
          signalStrength: SignalStrength.good,
          isCurrentlyConnected: false,
        ),
        Network(
          id: 'device-003',
          name: 'iPad',
          status: ConnectionStatus.available,
          signalStrength: SignalStrength.fair,
          isCurrentlyConnected: false,
        ),
      ];
      return devices[random.nextInt(devices.length)];
    }
    return null;
  }

  @override
  void dispose() {
    _scanTimer?.cancel();
    _discoveryStreamController.close();
  }
}
