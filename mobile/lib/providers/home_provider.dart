import 'package:flutter/material.dart';
import '../models/network.dart';
import '../services/device_discovery_service.dart';
import '../services/permission_service.dart';

class HomeProvider extends ChangeNotifier {
  final PermissionService permissionService;
  final DeviceDiscoveryService deviceDiscoveryService;

  bool _isFeatureEnabled = false;
  bool _permissionsGranted = false;
  bool _isLoading = false;
  List<Network> _availableNetworks = [];
  String? _errorMessage;

  HomeProvider({
    required this.permissionService,
    required this.deviceDiscoveryService,
  });

  // Getters
  bool get isFeatureEnabled => _isFeatureEnabled;
  bool get permissionsGranted => _permissionsGranted;
  bool get isLoading => _isLoading;
  List<Network> get availableNetworks => _availableNetworks;
  String? get errorMessage => _errorMessage;

  /// Toggle feature ON/OFF
  /// On first toggle, requests permissions
  Future<void> toggleFeature() async {
    if (!_isFeatureEnabled && !_permissionsGranted) {
      // First time: request permissions
      await _requestPermissions();
    } else if (!_isFeatureEnabled && _permissionsGranted) {
      // Already have permissions: just enable
      _isFeatureEnabled = true;
      notifyListeners();
      _startDiscovery();
    } else {
      // Disable feature
      _isFeatureEnabled = false;
      notifyListeners();
    }
  }

  /// Request all necessary permissions
  Future<void> _requestPermissions() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final hasPermissions = await permissionService.hasAllRequiredPermissions();
      if (hasPermissions) {
        _permissionsGranted = true;
        _isFeatureEnabled = true;
        _startDiscovery();
      } else {
        _errorMessage = 'Permissions denied. Please enable them in settings.';
      }
    } catch (e) {
      _errorMessage = 'Failed to request permissions: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Start discovering available networks
  Future<void> _startDiscovery() async {
    _isLoading = true;
    notifyListeners();

    try {
      final discoveredDevices = await deviceDiscoveryService.discoverDevices();

      // Convert discovered devices to networks
      _availableNetworks = discoveredDevices
          .map((device) => Network(
                id: device.id,
                name: device.name,
                status: device.isPaired ? ConnectionStatus.available : ConnectionStatus.available,
                signalStrength: SignalStrength.good, // TODO: Get actual signal strength
                isCurrentlyConnected: false,
              ))
          .toList();
    } catch (e) {
      _errorMessage = 'Failed to discover networks: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Connect to a specific network
  Future<void> connectToNetwork(Network network) async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      // TODO: Implement connection logic
      await deviceDiscoveryService.pairDevice(network.id);

      // Update network status
      final index = _availableNetworks.indexWhere((n) => n.id == network.id);
      if (index != -1) {
        _availableNetworks[index] = Network(
          id: network.id,
          name: network.name,
          status: ConnectionStatus.connected,
          signalStrength: network.signalStrength,
          isCurrentlyConnected: true,
        );
      }
    } catch (e) {
      _errorMessage = 'Failed to connect to network: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Clear error message
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
}
