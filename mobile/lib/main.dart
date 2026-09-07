import 'package:flutter/cupertino.dart';
import 'package:provider/provider.dart';
import 'config/app_config.dart';
import 'routes/app_routes.dart';
import 'providers/home_provider.dart';
import 'services/permission_service.dart';
import 'services/local_device_discovery.dart';
import 'services/auth_service.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AuthService>(
          create: (_) => AuthServiceImpl(
            apiBaseUrl: 'https://api.code-paste.example/v1',
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => HomeProvider(
            permissionService: PermissionServiceImpl(),
            deviceDiscovery: LocalDeviceDiscoveryImpl(),
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
