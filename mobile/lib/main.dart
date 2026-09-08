import 'package:flutter/cupertino.dart';
import 'package:provider/provider.dart';
import 'config/app_config.dart';
import 'routes/app_routes.dart';
import 'providers/home_provider.dart';
import 'services/permission_service.dart';
import 'services/local_device_discovery.dart';
import 'services/auth_service.dart';
import 'services/api_client.dart';
import 'services/peer_discovery_service.dart';
import 'services/control_plane_service.dart';
import 'services/clipboard_service.dart';
import 'services/clipboard_sync_service.dart';
import 'services/lan_transport_service.dart';
import 'services/lan_server_service.dart';
import 'services/transport_service.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    const apiBaseUrl = 'https://code-paste.onrender.com/v1';

    return MultiProvider(
      providers: [
        // API & Auth
        Provider<ApiClient>(create: (_) => ApiClient(baseUrl: apiBaseUrl)),
        Provider<AuthService>(
          create: (context) => AuthServiceImpl(
            apiBaseUrl: apiBaseUrl,
            apiClient: context.read<ApiClient>(),
          ),
        ),
        // Peer Discovery
        Provider<PeerDiscoveryService>(
          create: (context) =>
              PeerDiscoveryServiceImpl(apiClient: context.read<ApiClient>()),
        ),
        // Control Plane (for fetching signing keys)
        Provider<ControlPlaneService>(
          create: (context) => ControlPlaneService(
            apiClient: context.read<ApiClient>(),
            peerDiscovery: context.read<PeerDiscoveryService>(),
          ),
        ),
        // Clipboard
        Provider<ClipboardService>(create: (_) => ClipboardServiceImpl()),
        // LAN Transport
        Provider<LanTransportService>(
          create: (_) => LanTransportServiceImpl(
            deviceId: 'device-id-placeholder', // TODO: Get from auth
            privateKeyPem: '', // TODO: Get from auth
          ),
        ),
        Provider<LanServerService>(
          create: (_) => LanServerServiceImpl(
            deviceId: 'device-id-placeholder', // TODO: Get from auth
            privateKeyPem: '', // TODO: Get from auth
          ),
        ),
        Provider<TransportService>(
          create: (context) => TransportServiceImpl(
            clientTransport: context.read<LanTransportService>(),
            serverService: context.read<LanServerService>(),
          ),
        ),
        // Clipboard Sync
        Provider<ClipboardSyncService>(
          create: (context) => ClipboardSyncServiceImpl(
            clipboardService: context.read<ClipboardService>(),
            peerDiscoveryService: context.read<PeerDiscoveryService>(),
            transport: context.read<TransportService>(),
            deviceId: 'device-id-placeholder', // TODO: Get from auth
          ),
        ),
        // Home Provider
        ChangeNotifierProvider(
          create: (context) => HomeProvider(
            permissionService: PermissionServiceImpl(),
            deviceDiscovery: LocalDeviceDiscoveryImpl(),
            peerDiscoveryService: context.read<PeerDiscoveryService>(),
            clipboardSyncService: context.read<ClipboardSyncService>(),
            authService: context.read<AuthService>(),
          ),
        ),
      ],
      child: CupertinoApp.router(
        title: AppConfig.appName,
        routerConfig: AppRoutes.router,
        debugShowCheckedModeBanner: false,
        theme: const CupertinoThemeData(
          brightness: Brightness.light,
          textTheme: CupertinoTextThemeData(),
        ),
      ),
    );
  }
}
