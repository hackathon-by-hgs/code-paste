import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import '../../models/network.dart';

class CupertinoBottomSheet extends StatefulWidget {
  final List<Network> networks;
  final Function(Network) onNetworkSelected;
  final bool isLoading;

  const CupertinoBottomSheet({
    super.key,
    required this.networks,
    required this.onNetworkSelected,
    this.isLoading = false,
  });

  @override
  State<CupertinoBottomSheet> createState() => _CupertinoBottomSheetState();
}

class _CupertinoBottomSheetState extends State<CupertinoBottomSheet> {
  late DraggableScrollableController _controller;

  @override
  void initState() {
    super.initState();
    _controller = DraggableScrollableController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      controller: _controller,
      initialChildSize: 0.20,
      minChildSize: 0.15,
      maxChildSize: 0.90,
      snap: true,
      snapSizes: const [0.15, 0.50, 0.90],
      builder: (BuildContext context, ScrollController scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: CupertinoColors.systemBackground.resolveFrom(context),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(20),
              topRight: Radius.circular(20),
            ),
            boxShadow: [
              BoxShadow(
                color: CupertinoColors.black.withValues(alpha: 0.15),
                blurRadius: 20,
                offset: const Offset(0, -8),
              ),
            ],
          ),
          child: ListView(
            controller: scrollController,
            padding: EdgeInsets.zero,
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              // The handle shares the sheet's scroll controller.
              Container(
                key: const ValueKey('network-sheet-handle'),
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Drag handle indicator
                    Container(
                      width: 40,
                      height: 5,
                      decoration: BoxDecoration(
                        color: CupertinoColors.systemGrey3.resolveFrom(context),
                        borderRadius: BorderRadius.circular(2.5),
                      ),
                    ),
                  ],
                ),
              ),
              // Title section
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Available Networks',
                          style: CupertinoTheme.of(context)
                              .textTheme
                              .navTitleTextStyle
                              .copyWith(
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                letterSpacing: -0.5,
                              ),
                        ),
                        if (widget.networks.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            '${widget.networks.length} device${widget.networks.length == 1 ? '' : 's'} found',
                            style: CupertinoTheme.of(context)
                                .textTheme
                                .textStyle
                                .copyWith(
                                  fontSize: 13,
                                  color: CupertinoColors.systemGrey.resolveFrom(
                                    context,
                                  ),
                                  fontWeight: FontWeight.w400,
                                ),
                          ),
                        ] else
                          const SizedBox(height: 4),
                        if (widget.isLoading)
                          Text(
                            'Scanning...',
                            style: CupertinoTheme.of(context)
                                .textTheme
                                .textStyle
                                .copyWith(
                                  fontSize: 12,
                                  color: CupertinoColors.systemGreen,
                                  fontWeight: FontWeight.w500,
                                ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              // Separator
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Container(
                  height: 1,
                  color: CupertinoColors.systemGrey4.resolveFrom(context),
                ),
              ),
              // Networks list
              if (widget.networks.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        widget.isLoading
                            ? CupertinoIcons.wifi
                            : CupertinoIcons.wifi_slash,
                        size: 48,
                        color: widget.isLoading
                            ? CupertinoColors.systemGreen
                            : CupertinoColors.systemGrey3.resolveFrom(context),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        widget.isLoading
                            ? 'Searching for Devices'
                            : 'No Networks Found',
                        style: CupertinoTheme.of(context).textTheme.textStyle
                            .copyWith(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        widget.isLoading
                            ? 'Scanning your network for available devices...'
                            : 'Make sure your devices are on the same network',
                        style: CupertinoTheme.of(context).textTheme.textStyle
                            .copyWith(
                              fontSize: 13,
                              color: CupertinoColors.systemGrey.resolveFrom(
                                context,
                              ),
                            ),
                        textAlign: TextAlign.center,
                      ),
                      if (widget.isLoading) ...[
                        const SizedBox(height: 24),
                        const CupertinoActivityIndicator(radius: 14),
                      ],
                    ],
                  ),
                )
              else ...[
                ...widget.networks.map(
                  (network) => _buildNetworkTile(context, network),
                ),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Swipe down to dismiss',
                    style: CupertinoTheme.of(context).textTheme.textStyle
                        .copyWith(
                          fontSize: 12,
                          color: CupertinoColors.systemGrey.resolveFrom(
                            context,
                          ),
                        ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildNetworkTile(BuildContext context, Network network) {
    final isConnected = network.isCurrentlyConnected;

    return CupertinoButton(
      padding: EdgeInsets.zero,
      onPressed: () {
        HapticFeedback.mediumImpact();
        widget.onNetworkSelected(network);
      },
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: isConnected
              ? CupertinoColors.systemGreen.withValues(alpha: 0.1)
              : CupertinoColors.systemGrey6.resolveFrom(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isConnected
                ? CupertinoColors.systemGreen
                : CupertinoColors.systemGrey4.resolveFrom(context),
            width: isConnected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              decoration: BoxDecoration(
                color: isConnected
                    ? CupertinoColors.systemGreen.withValues(alpha: 0.15)
                    : CupertinoColors.systemGrey5.resolveFrom(context),
                borderRadius: BorderRadius.circular(8),
              ),
              padding: const EdgeInsets.all(8),
              child: Icon(
                CupertinoIcons.device_desktop,
                color: isConnected
                    ? CupertinoColors.systemGreen
                    : CupertinoColors.systemGrey,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    network.name,
                    style: CupertinoTheme.of(context).textTheme.textStyle
                        .copyWith(fontSize: 16, fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (isConnected)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: Container(
                            decoration: BoxDecoration(
                              color: CupertinoColors.systemGreen.withValues(
                                alpha: 0.2,
                              ),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            child: Text(
                              'Connected',
                              style: CupertinoTheme.of(context)
                                  .textTheme
                                  .textStyle
                                  .copyWith(
                                    fontSize: 11,
                                    color: CupertinoColors.systemGreen,
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                          ),
                        ),
                      ..._buildSignalBars(network.getSignalBars()),
                      const SizedBox(width: 6),
                      Text(
                        network.getSignalLabel(),
                        style: CupertinoTheme.of(context).textTheme.textStyle
                            .copyWith(
                              fontSize: 12,
                              color: CupertinoColors.systemGrey.resolveFrom(
                                context,
                              ),
                            ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Icon(
                isConnected
                    ? CupertinoIcons.checkmark_alt_circle_fill
                    : CupertinoIcons.chevron_right,
                color: isConnected
                    ? CupertinoColors.systemGreen
                    : CupertinoColors.systemGrey3.resolveFrom(context),
                size: 20,
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildSignalBars(int bars) {
    return List.generate(4, (index) {
      final isActive = index < bars;
      return Padding(
        padding: const EdgeInsets.only(right: 1.5),
        child: Container(
          width: 2,
          height: 10 + (index * 2),
          decoration: BoxDecoration(
            color: isActive
                ? CupertinoColors.systemGrey
                : CupertinoColors.systemGrey4,
            borderRadius: BorderRadius.circular(1),
          ),
        ),
      );
    });
  }
}
