import 'package:flutter/cupertino.dart';
import '../../models/network.dart';

class CupertinoNetworkList extends StatelessWidget {
  final List<Network> networks;
  final Function(Network) onNetworkSelected;
  final bool isLoading;

  const CupertinoNetworkList({
    Key? key,
    required this.networks,
    required this.onNetworkSelected,
    this.isLoading = false,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    if (networks.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              CupertinoIcons.wifi_slash,
              size: 48,
              color: CupertinoColors.systemGrey3.resolveFrom(context),
            ),
            const SizedBox(height: 16),
            Text(
              'No Networks Found',
              style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'Searching for devices',
              style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                    fontSize: 13,
                    color: CupertinoColors.systemGrey.resolveFrom(context),
                  ),
            ),
          ],
        ),
      );
    }

    return CupertinoListSection.insetGrouped(
      children: [
        ...networks.map((network) {
          return CupertinoListTile(
            title: Text(network.name),
            subtitle: _buildStatusSubtitle(context, network),
            leading: _buildNetworkIcon(network.isCurrentlyConnected),
            trailing: _buildTrailing(network),
            onTap: isLoading ? null : () => onNetworkSelected(network),
          );
        }).toList(),
      ],
    );
  }

  Widget _buildStatusSubtitle(BuildContext context, Network network) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (network.isCurrentlyConnected)
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text(
              'Connected',
              style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                    fontSize: 13,
                    color: CupertinoColors.systemGreen,
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ..._buildSignalBars(network.getSignalBars()),
        const SizedBox(width: 8),
        Text(
          network.getSignalLabel(),
          style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                fontSize: 12,
                color: CupertinoColors.systemGrey.resolveFrom(context),
              ),
        ),
      ],
    );
  }

  List<Widget> _buildSignalBars(int bars) {
    return List.generate(4, (index) {
      final isActive = index < bars;
      return Padding(
        padding: const EdgeInsets.only(right: 2),
        child: Container(
          width: 1.5,
          height: 8 + (index * 1.5),
          decoration: BoxDecoration(
            color: isActive
                ? CupertinoColors.systemGrey
                : CupertinoColors.systemGrey4,
            borderRadius: BorderRadius.circular(0.75),
          ),
        ),
      );
    });
  }

  Widget _buildNetworkIcon(bool isConnected) {
    return Icon(
      CupertinoIcons.device_desktop,
      color: isConnected
          ? CupertinoColors.systemGreen
          : CupertinoColors.systemGrey,
    );
  }

  Widget _buildTrailing(Network network) {
    if (network.isCurrentlyConnected) {
      return Icon(
        CupertinoIcons.checkmark_alt,
        color: CupertinoColors.systemGreen,
      );
    }
    return Icon(
      CupertinoIcons.chevron_right,
      color: CupertinoColors.systemGrey3,
    );
  }
}
