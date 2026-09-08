import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../screens/splash/splash_screen.dart';
import '../screens/home/home_screen_cupertino.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/signup_screen.dart';
import '../screens/auth/device_setup_screen.dart';
import '../screens/sharing/share_sessions_screen.dart';
import '../services/auth_service.dart';

class AppRoutes {
  static const String splash = '/';
  static const String home = '/home';
  static const String login = '/login';
  static const String signup = '/signup';
  static const String deviceSetup = '/device-setup';
  static const String sessions = '/sessions';

  static final GoRouter router = GoRouter(
    initialLocation: splash,
    redirect: (context, state) async {
      final authService = context.read<AuthService>();
      final tokens = await authService.getStoredTokens();

      final isSplash = state.matchedLocation == splash;
      final isLogin = state.matchedLocation == login;
      final isSignup = state.matchedLocation == signup;

      if (tokens == null) {
        if (isSplash) {
          return login;
        }
        if (isSignup) return null;
        if (isLogin) return null;
        return login;
      } else {
        if (isSplash || isLogin || isSignup) {
          return home;
        }
      }

      return null;
    },
    routes: [
      GoRoute(path: splash, builder: (context, state) => const SplashScreen()),
      GoRoute(path: login, builder: (context, state) => const LoginScreen()),
      GoRoute(path: signup, builder: (context, state) => const SignupScreen()),
      GoRoute(
        path: deviceSetup,
        builder: (context, state) => const DeviceSetupScreen(),
      ),
      GoRoute(
        path: home,
        builder: (context, state) => const HomeScreenCupertino(),
      ),
      GoRoute(
        path: sessions,
        builder: (context, state) => const ShareSessionsScreen(),
      ),
    ],
  );
}
