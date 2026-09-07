import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../config/app_config.dart';
import '../../models/app_state.dart';
import '../../models/network.dart';
import '../../providers/home_provider.dart';
import '../../widgets/cupertino/cupertino_power_button.dart';
import '../../widgets/cupertino/cupertino_network_list.dart';
import '../../widgets/cupertino/cupertino_bottom_sheet.dart';

class HomeScreenCupertino extends StatefulWidget {
  const HomeScreenCupertino({Key? key}) : super(key: key);

  @override
  State<HomeScreenCupertino> createState() => _HomeScreenCupertinoState();
}

class _HomeScreenCupertinoState extends State<HomeScreenCupertino>
    with TickerProviderStateMixin {
  late AnimationController _buttonAnimationController;

  @override
  void initState() {
    super.initState();
    _buttonAnimationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );

    // Initialize the app state
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<HomeProvider>().initialize();
    });
  }

  @override
  void didUpdateWidget(HomeScreenCupertino oldWidget) {
    super.didUpdateWidget(oldWidget);
    final provider = context.read<HomeProvider>();
    if (provider.isActive && !_buttonAnimationController.isCompleted) {
      _buttonAnimationController.forward();
    } else if (!provider.isActive && _buttonAnimationController.isCompleted) {
      _buttonAnimationController.reverse();
    }
  }

  @override
  void dispose() {
    _buttonAnimationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      navigationBar: CupertinoNavigationBar(
        middle: Text(AppConfig.appName),
        backgroundColor: CupertinoColors.systemBackground.resolveFrom(context),
        border: null,
      ),
      child: Consumer<HomeProvider>(
        builder: (context, provider, child) {
          return SafeArea(
            child: Stack(
              children: [
                // Main content
                Column(
                  children: [
                    Expanded(
                      child: Center(
                        child: _buildPowerButton(context, provider),
                      ),
                    ),
                  ],
                ),

                // Error overlay
                if (provider.error != null)
                  Positioned(
                    bottom: 100,
                    left: 16,
                    right: 16,
                    child: _buildErrorMessage(context, provider),
                  ),

                // Bottom sheet for networks
                if (provider.isActive)
                  CupertinoBottomSheet(
                    networks: provider.availableNetworks,
                    isLoading: provider.state == AppLifecycleState.scanning,
                    onNetworkSelected: (network) {
                      provider.connectToNetwork(network);
                    },
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildPowerButton(BuildContext context, HomeProvider provider) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Status text
        Text(
          provider.isActive ? 'Connected' : 'Ready to Connect',
          style: CupertinoTheme.of(context).textTheme.navLargeTitleTextStyle,
        ),
        const SizedBox(height: 12),
        Text(
          provider.isActive
              ? 'Your clipboard is syncing'
              : 'Tap to enable clipboard sync',
          style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                color: CupertinoColors.secondaryLabel.resolveFrom(context),
                fontSize: 15,
              ),
        ),
        const SizedBox(height: 60),
        // Power button
        CupertinoPowerButton(
          isActive: provider.isActive,
          isLoading: provider.isLoading,
          onPressed: () {
            HapticFeedback.lightImpact();
            provider.toggleFeature();
          },
          animationController: _buttonAnimationController,
        ),
      ],
    );
  }

  Widget _buildErrorMessage(BuildContext context, HomeProvider provider) {
    final error = provider.error!;

    return Container(
      decoration: BoxDecoration(
        color: CupertinoColors.destructiveRed,
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      error.message,
                      style: CupertinoTheme.of(context)
                          .textTheme
                          .textStyle
                          .copyWith(
                            color: CupertinoColors.white,
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          ),
                    ),
                    if (error.details != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        error.details!,
                        style:
                            CupertinoTheme.of(context).textTheme.textStyle
                                .copyWith(
                          color: CupertinoColors.white.withOpacity(0.8),
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              CupertinoButton(
                padding: EdgeInsets.zero,
                onPressed: () {
                  HapticFeedback.lightImpact();
                  provider.clearError();
                },
                child: Icon(
                  CupertinoIcons.xmark_circle_fill,
                  color: CupertinoColors.white.withOpacity(0.7),
                ),
              ),
            ],
          ),
          if (error.recoverable) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: CupertinoButton(
                color: CupertinoColors.white.withOpacity(0.2),
                onPressed: () {
                  provider.retryActivation();
                },
                child: Text(
                  'Try Again',
                  style: CupertinoTheme.of(context).textTheme.textStyle
                      .copyWith(
                    color: CupertinoColors.white,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
