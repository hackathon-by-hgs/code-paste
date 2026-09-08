import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:async';
import '../models/network.dart';
import '../models/app_state.dart';
import '../services/permission_service.dart';
import '../services/local_device_discovery.dart';
import '../services/peer_discovery_service.dart';
import '../services/clipboard_sync_service.dart';
import '../services/auth_service.dart';

class HomeProvider extends ChangeNotifier {
  final PermissionService permissionService;
  final LocalDeviceDiscovery deviceDiscovery;
  final PeerDiscoveryService peerDiscoveryService;
  final ClipboardSyncService clipboardSyncService;
  final AuthService authService;

  AppLifecycleState _state = AppLifecycleState.initializing;
  PermissionStatus _permissionStatus = PermissionStatus.notRequested;
  List<Network> _availableNetworks = [];
  Network? _connectedNetwork;
  AppError? _error;
  bool _clipboardSyncEnabled = false;
  StreamSubscription? _clipboardEventSubscription;

  HomeProvider({
    required this.permissionService,
    required this.deviceDiscovery,
    required this.peerDiscoveryService,
    required this.clipboardSyncService,
    required this.authService,
  });

  // Getters
  AppLifecycleState get state => _state;
  PermissionStatus get permissionStatus => _permissionStatus;
  List<Network> get availableNetworks => _availableNetworks;
  Network? get connectedNetwork => _connectedNetwork;
  AppError? get error => _error;
  bool get clipboardSyncEnabled => _clipboardSyncEnabled;

  bool get isActive => _state == AppLifecycleState.active;
  bool get isLoading =>
      _state == AppLifecycleState.activating ||
      _state == AppLifecycleState.connecting ||
      _state == AppLifecycleState.scanning;

  /// Initialize the app state
  Future<void> initialize() async {
    _state = AppLifecycleState.initializing;
    notifyListeners();

    _state = AppLifecycleState.ready;
    _permissionStatus = PermissionStatus.notRequested;
    notifyListeners();
  }

  /// Toggle feature ON/OFF
  Future<void> toggleFeature() async {
    if (_state == AppLifecycleState.ready) {
      await _activateFeature();
    } else if (_state == AppLifecycleState.active) {
      await _deactivateFeature();
    }
  }

  /// Activate feature: request permissions and start discovery
  Future<void> _activateFeature() async {
    _state = AppLifecycleState.activating;
    _error = null;
    notifyListeners();

    try {
      // Request permissions
      final hasPermissions = await permissionService
          .hasAllRequiredPermissions();

      if (!hasPermissions) {
        _state = AppLifecycleState.permissionRequired;
        _permissionStatus = PermissionStatus.denied;
        _error = AppError(
          message: 'Permissions Required',
          details: 'Local network and Bluetooth access are needed.',
          recoverable: true,
        );
        notifyListeners();
        return;
      }

      _permissionStatus = PermissionStatus.granted;

      // Haptic feedback: success
      await HapticFeedback.mediumImpact();

      // Fetch peer roster
      try {
        await peerDiscoveryService.fetchPeerRoster();
        developer.log(
          'Peer roster fetched: ${peerDiscoveryService.getAvailablePeers().length} peers',
        );
      } catch (e) {
        developer.log('Failed to fetch peer roster: $e');
        _error = AppError(
          message: 'Roster Fetch Failed',
          details: 'Could not fetch peer roster: $e',
          recoverable: true,
        );
      }

      // Start clipboard sync
      try {
        await clipboardSyncService.start();
        _clipboardSyncEnabled = true;

        // Listen to clipboard events
        _clipboardEventSubscription = clipboardSyncService.receivedEvents
            .listen(
              (event) {
                developer.log('Received clipboard event: ${event.eventId}');
                notifyListeners();
              },
              onError: (e) {
                developer.log('Clipboard sync error: $e');
                _error = AppError(
                  message: 'Sync Error',
                  details: e.toString(),
                  recoverable: true,
                );
                notifyListeners();
              },
            );
      } catch (e) {
        developer.log('Failed to start clipboard sync: $e');
      }

      // Move to active state and start discovery
      _state = AppLifecycleState.active;
      notifyListeners();

      _startDiscovery();
    } catch (e) {
      _state = AppLifecycleState.ready;
      _error = AppError(
        message: 'Activation Failed',
        details: e.toString(),
        recoverable: true,
      );
      notifyListeners();
    }
  }

  /// Start discovering local devices
  Future<void> _startDiscovery() async {
    _state = AppLifecycleState.scanning;
    _availableNetworks = [];
    notifyListeners();

    try {
      // Start discovery
      await deviceDiscovery.discoverDevices();

      // Listen to discovery stream
      deviceDiscovery.discoveryStream.listen(
        (device) {
          if (!_availableNetworks.any((n) => n.id == device.id)) {
            _availableNetworks.add(device);
            notifyListeners();
          }
        },
        onError: (e) {
          _error = AppError(
            message: 'Discovery Error',
            details: 'Failed to discover devices.',
            recoverable: true,
          );
          notifyListeners();
        },
      );

      // After discovery completes, return to active state
      // Return to active regardless of whether devices were found
      await Future.delayed(const Duration(seconds: 3));
      if (_state == AppLifecycleState.scanning) {
        _state = AppLifecycleState.active;
        notifyListeners();
      }
    } catch (e) {
      _error = AppError(
        message: 'Discovery Failed',
        details: e.toString(),
        recoverable: true,
      );
      if (_state == AppLifecycleState.scanning) {
        _state = AppLifecycleState.active;
      }
      notifyListeners();
    }
  }

  /// Connect to a network
  Future<void> connectToNetwork(Network network) async {
    _state = AppLifecycleState.connecting;
    _error = null;
    notifyListeners();

    try {
      // Simulate connection delay
      await Future.delayed(const Duration(seconds: 1));

      // Haptic feedback: success
      await HapticFeedback.mediumImpact();

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

        // Disconnect previous network
        for (var i = 0; i < _availableNetworks.length; i++) {
          if (i != index && _availableNetworks[i].isCurrentlyConnected) {
            _availableNetworks[i] = Network(
              id: _availableNetworks[i].id,
              name: _availableNetworks[i].name,
              status: ConnectionStatus.available,
              signalStrength: _availableNetworks[i].signalStrength,
              isCurrentlyConnected: false,
            );
          }
        }

        _connectedNetwork = _availableNetworks[index];
      }

      _state = AppLifecycleState.active;
      notifyListeners();
    } catch (e) {
      _error = AppError(
        message: 'Connection Failed',
        details: 'Unable to connect to the network.',
        recoverable: true,
      );
      _state = AppLifecycleState.active;
      notifyListeners();
    }
  }

  /// Deactivate feature
  Future<void> _deactivateFeature() async {
    _state = AppLifecycleState.deactivating;
    notifyListeners();

    try {
      // Stop clipboard sync
      if (_clipboardSyncEnabled) {
        await clipboardSyncService.stop();
        await clipboardSyncService.dispose();
        _clipboardSyncEnabled = false;
        await _clipboardEventSubscription?.cancel();
      }

      // Stop device discovery
      await deviceDiscovery.stopDiscovery();
      _availableNetworks = [];
      _connectedNetwork = null;

      // Haptic feedback
      await HapticFeedback.lightImpact();

      _state = AppLifecycleState.ready;
      notifyListeners();
    } catch (e) {
      _state = AppLifecycleState.ready;
      notifyListeners();
    }
  }

  /// Clear error
  void clearError() {
    _error = null;
    notifyListeners();
  }

  /// Retry activation after permission denial
  Future<void> retryActivation() async {
    _error = null;
    await _activateFeature();
  }

  @override
  void dispose() {
    _clipboardEventSubscription?.cancel();
    deviceDiscovery.dispose();
    super.dispose();
  }
}
