import 'package:flutter/material.dart';
import '../models/network.dart';
import '../config/app_theme.dart';

class NetworkItem extends StatelessWidget {
  final Network network;
  final VoidCallback onTap;
  final bool isLoading;

  const NetworkItem({
    Key? key,
    required this.network,
    required this.onTap,
    this.isLoading = false,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: network.isCurrentlyConnected ? AppTheme.primaryColor : AppTheme.borderColor,
            width: network.isCurrentlyConnected ? 2 : 1,
          ),
          boxShadow: [
            if (network.isCurrentlyConnected)
              BoxShadow(
                color: AppTheme.primaryColor.withOpacity(0.2),
                blurRadius: 8,
                spreadRadius: 2,
              ),
          ],
        ),
        child: Row(
          children: [
            // Network icon and name
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      // Network icon
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: AppTheme.backgroundColor,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          Icons.devices_other,
                          color: network.isCurrentlyConnected
                              ? AppTheme.primaryColor
                              : AppTheme.textSecondary,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      // Name and status
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              network.name,
                              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: AppTheme.textPrimary,
                                  ),
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              network.isCurrentlyConnected ? 'Connected' : 'Available',
                              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: network.isCurrentlyConnected
                                        ? AppTheme.secondaryColor
                                        : AppTheme.textSecondary,
                                    fontWeight: FontWeight.w500,
                                  ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Signal strength indicator
                  Row(
                    children: [
                      // Signal bars
                      ..._buildSignalBars(network.getSignalBars()),
                      const SizedBox(width: 8),
                      Text(
                        network.getSignalLabel(),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: AppTheme.textSecondary,
                            ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            // Connection button or checkmark
            if (network.isCurrentlyConnected)
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppTheme.secondaryColor,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check,
                  color: Colors.white,
                  size: 20,
                ),
              )
            else if (isLoading)
              SizedBox(
                width: 36,
                height: 36,
                child: CircularProgressIndicator(
                  valueColor: AlwaysStoppedAnimation<Color>(AppTheme.primaryColor),
                  strokeWidth: 2,
                ),
              )
            else
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppTheme.primaryColor.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.arrow_forward,
                  color: AppTheme.primaryColor,
                  size: 18,
                ),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildSignalBars(int bars) {
    return List.generate(4, (index) {
      return Padding(
        padding: const EdgeInsets.only(right: 2),
        child: Container(
          width: 2,
          height: 8 + (index * 2),
          decoration: BoxDecoration(
            color: index < bars ? AppTheme.primaryColor : AppTheme.borderColor,
            borderRadius: BorderRadius.circular(1),
          ),
        ),
      );
    });
  }
}
