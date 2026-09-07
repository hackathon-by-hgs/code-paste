import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../config/app_config.dart';
import '../../models/app_state.dart';
import '../../providers/home_provider.dart';
import '../../widgets/cupertino/cupertino_power_button.dart';
import '../../widgets/cupertino/cupertino_bottom_sheet.dart';

class HomeScreenCupertino extends StatefulWidget {
  const HomeScreenCupertino({super.key});

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
    final statusMessage = _getStatusMessage(provider);
    final subtitleMessage = _getSubtitleMessage(provider);
    final statusColor = _getStatusColor(provider);

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        // Status text
        Text(
          statusMessage,
          style: CupertinoTheme.of(
            context,
          ).textTheme.navLargeTitleTextStyle.copyWith(color: statusColor),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Text(
          subtitleMessage,
          style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
            color: CupertinoColors.secondaryLabel.resolveFrom(context),
            fontSize: 15,
          ),
          textAlign: TextAlign.center,
        ),
        if (provider.isActive && provider.availableNetworks.isNotEmpty)
          _buildDeviceIndicator(context, provider),
        if (provider.connectedNetwork != null)
          _buildConnectedIndicator(context, provider),
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

  String _getStatusMessage(HomeProvider provider) {
    switch (provider.state) {
      case AppLifecycleState.initializing:
        return 'Starting...';
      case AppLifecycleState.ready:
        return 'Ready to Connect';
      case AppLifecycleState.permissionRequired:
        return 'Permissions Required';
      case AppLifecycleState.activating:
        return 'Activating...';
      case AppLifecycleState.active:
        return 'Connected';
      case AppLifecycleState.scanning:
        return 'Scanning for Devices';
      case AppLifecycleState.connecting:
        return 'Connecting...';
      case AppLifecycleState.connected:
        return 'Connected';
      case AppLifecycleState.connectionFailed:
        return 'Connection Failed';
      case AppLifecycleState.deactivating:
        return 'Turning Off...';
      case AppLifecycleState.error:
        return 'Error';
    }
  }

  String _getSubtitleMessage(HomeProvider provider) {
    switch (provider.state) {
      case AppLifecycleState.initializing:
        return 'Loading app...';
      case AppLifecycleState.ready:
        return 'Tap to enable clipboard sync';
      case AppLifecycleState.permissionRequired:
        return 'Local network access is needed';
      case AppLifecycleState.activating:
        return 'Requesting permissions...';
      case AppLifecycleState.active:
        return provider.availableNetworks.isEmpty
            ? 'Looking for devices...'
            : 'Tap to select a device';
      case AppLifecycleState.scanning:
        return 'Searching for devices on your network...';
      case AppLifecycleState.connecting:
        return 'Connecting to device...';
      case AppLifecycleState.connected:
        return 'Your clipboard is syncing';
      case AppLifecycleState.connectionFailed:
        return 'Could not connect to device';
      case AppLifecycleState.deactivating:
        return 'Stopping sync...';
      case AppLifecycleState.error:
        return 'Something went wrong';
    }
  }

  Color _getStatusColor(HomeProvider provider) {
    if (provider.state == AppLifecycleState.permissionRequired ||
        provider.state == AppLifecycleState.error ||
        provider.state == AppLifecycleState.connectionFailed) {
      return CupertinoColors.destructiveRed;
    }
    if (provider.isActive || provider.state == AppLifecycleState.connected) {
      return CupertinoColors.systemGreen;
    }
    return CupertinoColors.label.resolveFrom(context);
  }

  Widget _buildDeviceIndicator(BuildContext context, HomeProvider provider) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        decoration: BoxDecoration(
          color: CupertinoColors.systemGrey6.resolveFrom(context),
          borderRadius: BorderRadius.circular(8),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Text(
          '${provider.availableNetworks.length} device${provider.availableNetworks.length == 1 ? '' : 's'} found',
          style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
            fontSize: 13,
            color: CupertinoColors.secondaryLabel.resolveFrom(context),
          ),
        ),
      ),
    );
  }

  Widget _buildConnectedIndicator(BuildContext context, HomeProvider provider) {
    final network = provider.connectedNetwork!;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(
              color: CupertinoColors.systemGreen,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            'Connected to ${network.name}',
            style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
              fontSize: 13,
              color: CupertinoColors.systemGreen,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorMessage(BuildContext context, HomeProvider provider) {
    final error = provider.error!;

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: BackdropFilter(
        filter: const ColorFilter.matrix([
          0.8,
          0,
          0,
          0,
          0,
          0,
          0.8,
          0,
          0,
          0,
          0,
          0,
          0.8,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
        ]),
        child: Container(
          decoration: BoxDecoration(
            color: CupertinoColors.destructiveRed.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: CupertinoColors.destructiveRed,
              width: 0.5,
            ),
            boxShadow: [
              BoxShadow(
                color: CupertinoColors.destructiveRed.withValues(alpha: 0.3),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    CupertinoIcons.exclamationmark_circle_fill,
                    color: CupertinoColors.white,
                    size: 20,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          error.message,
                          style: CupertinoTheme.of(context).textTheme.textStyle
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
                            style: CupertinoTheme.of(context)
                                .textTheme
                                .textStyle
                                .copyWith(
                                  color: CupertinoColors.white.withValues(
                                    alpha: 0.85,
                                  ),
                                  fontSize: 12,
                                ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      provider.clearError();
                    },
                    child: Icon(
                      CupertinoIcons.xmark_circle_fill,
                      color: CupertinoColors.white.withValues(alpha: 0.6),
                      size: 20,
                    ),
                  ),
                ],
              ),
              if (error.recoverable) ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: CupertinoButton(
                    padding: const EdgeInsets.symmetric(
                      vertical: 10,
                      horizontal: 12,
                    ),
                    color: CupertinoColors.white.withValues(alpha: 0.25),
                    onPressed: () {
                      HapticFeedback.mediumImpact();
                      provider.retryActivation();
                    },
                    child: Text(
                      'Try Again',
                      style: CupertinoTheme.of(context).textTheme.textStyle
                          .copyWith(
                            color: CupertinoColors.white,
                            fontWeight: FontWeight.w500,
                            fontSize: 14,
                          ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
