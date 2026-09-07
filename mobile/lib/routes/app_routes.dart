import 'package:go_router/go_router.dart';
import '../screens/splash/splash_screen.dart';
import '../screens/home/home_screen_cupertino.dart';

class AppRoutes {
  static const String splash = '/';
  static const String home = '/home';

  static final GoRouter router = GoRouter(
    initialLocation: splash,
    routes: [
      GoRoute(
        path: splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: home,
        builder: (context, state) => const HomeScreenCupertino(),
      ),
    ],
  );
}
