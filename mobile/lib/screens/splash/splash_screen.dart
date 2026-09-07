import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../../config/app_config.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({Key? key}) : super(key: key);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );

    _animationController.forward();
    _navigateToHome();
  }

  void _navigateToHome() {
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) {
        // TODO: Check if user is authenticated
        // For now, go to login
        context.go('/login');
      }
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      backgroundColor: CupertinoColors.black,
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Logo with fade and scale animation
            FadeTransition(
              opacity: _animationController,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.5, end: 1.0).animate(
                  CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
                ),
                child: Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: CupertinoColors.white,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Center(
                    child: Icon(
                      CupertinoIcons.doc_on_clipboard,
                      size: 48,
                      color: CupertinoColors.black,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),
            // App name
            FadeTransition(
              opacity: Tween<double>(begin: 0, end: 1).animate(
                CurvedAnimation(
                  parent: _animationController,
                  curve: const Interval(0.2, 1.0, curve: Curves.easeOut),
                ),
              ),
              child: Text(
                AppConfig.appName,
                style: CupertinoTheme.of(context).textTheme.navLargeTitleTextStyle
                    .copyWith(
                  color: CupertinoColors.white,
                  fontSize: 32,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1,
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Subtitle
            FadeTransition(
              opacity: Tween<double>(begin: 0, end: 1).animate(
                CurvedAnimation(
                  parent: _animationController,
                  curve: const Interval(0.3, 1.0, curve: Curves.easeOut),
                ),
              ),
              child: Text(
                'Sync clipboard across devices',
                style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                  color: CupertinoColors.systemGrey,
                  fontSize: 16,
                  letterSpacing: 0.3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
