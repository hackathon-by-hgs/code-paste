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

    // Simulate mDNS discovery by periodically scanning
    _scanTimer = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      // In a real implementation, this would use platform channels to:
      // - iOS: NSNetServiceBrowser + NSNetService
      // - Android: NsdManager
      // For now, we simulate with mock devices

      final newDevice = _generateMockDevice();
      if (newDevice != null &&
          !_discoveredDevices.any((d) => d.id == newDevice.id)) {
        _discoveredDevices.add(newDevice);
        _discoveryStreamController.add(newDevice);
      }

      // Stop after finding a reasonable number of devices
      if (_discoveredDevices.length >= 3) {
        await stopDiscovery();
      }
    });

    // Return immediately with empty list, stream will provide updates
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
