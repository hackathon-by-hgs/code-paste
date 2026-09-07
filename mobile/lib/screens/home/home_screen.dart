import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../config/app_config.dart';
import '../../config/app_theme.dart';
import '../../providers/home_provider.dart';
import '../../widgets/power_button.dart';
import '../../widgets/networks_bottom_sheet.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          AppConfig.appName,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        centerTitle: true,
        elevation: 0.5,
      ),
      body: Consumer<HomeProvider>(
        builder: (context, homeProvider, child) {
          return Stack(
            children: [
              // Main content with power button
              Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Status text
                    Text(
                      homeProvider.isFeatureEnabled ? 'Clipboard Sync' : 'Enable Clipboard Sync',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            color: AppTheme.textPrimary,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      homeProvider.isFeatureEnabled
                          ? 'Sync is active and ready'
                          : 'Tap to enable and set permissions',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppTheme.textSecondary,
                          ),
                    ),
                    const SizedBox(height: 60),
                    // Power button
                    PowerButton(
                      isEnabled: homeProvider.isFeatureEnabled,
                      isLoading: homeProvider.isLoading,
                      onPressed: () => homeProvider.toggleFeature(),
                    ),
                  ],
                ),
              ),
              // Error message
              if (homeProvider.errorMessage != null)
                Positioned(
                  bottom: 100,
                  left: 16,
                  right: 16,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: AppTheme.errorColor,
                      borderRadius: BorderRadius.circular(AppConfig.defaultBorderRadius),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.error_outline,
                          color: Colors.white,
                          size: 20,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            homeProvider.errorMessage!,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: Colors.white,
                                ),
                          ),
                        ),
                        GestureDetector(
                          onTap: homeProvider.clearError,
                          child: const Icon(
                            Icons.close,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              // Draggable bottom sheet for networks
              NetworksBottomSheet(
                networks: homeProvider.availableNetworks,
                isLoading: homeProvider.isLoading,
                isFeatureEnabled: homeProvider.isFeatureEnabled,
                onNetworkSelected: (network) {
                  homeProvider.connectToNetwork(network);
                },
              ),
            ],
          );
        },
      ),
    );
  }
}
