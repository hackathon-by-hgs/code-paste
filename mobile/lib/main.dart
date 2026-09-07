import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'config/app_config.dart';
import 'config/app_theme.dart';
import 'routes/app_routes.dart';
import 'providers/home_provider.dart';
import 'services/permission_service.dart';
import 'services/device_discovery_service.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => HomeProvider(
            permissionService: PermissionServiceImpl(),
            deviceDiscoveryService: DeviceDiscoveryServiceImpl(),
          ),
        ),
      ],
      child: MaterialApp.router(
        title: AppConfig.appName,
        theme: AppTheme.lightTheme(),
        routerConfig: AppRoutes.router,
        debugShowCheckedModeBanner: false,
      ),
    );
  }
}
