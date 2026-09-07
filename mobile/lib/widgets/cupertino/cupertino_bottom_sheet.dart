import 'package:flutter/cupertino.dart';
import '../../models/network.dart';
import 'cupertino_network_list.dart';

class CupertinoBottomSheet extends StatefulWidget {
  final List<Network> networks;
  final Function(Network) onNetworkSelected;
  final bool isLoading;

  const CupertinoBottomSheet({
    Key? key,
    required this.networks,
    required this.onNetworkSelected,
    this.isLoading = false,
  }) : super(key: key);

  @override
  State<CupertinoBottomSheet> createState() => _CupertinoBottomSheetState();
}

class _CupertinoBottomSheetState extends State<CupertinoBottomSheet> {
  late DraggableScrollableController _controller;
  late double _currentSize;

  @override
  void initState() {
    super.initState();
    _controller = DraggableScrollableController();
    _currentSize = 0.15;
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
      initialChildSize: 0.15,
      minChildSize: 0.15,
      maxChildSize: 0.85,
      snap: true,
      snapSizes: const [0.15, 0.5, 0.85],
      onDragged: (size) {
        _currentSize = size;
      },
      builder: (BuildContext context, ScrollController scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: CupertinoColors.systemBackground.resolveFrom(context),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
            ),
            boxShadow: [
              BoxShadow(
                color: CupertinoColors.black.withOpacity(0.1),
                blurRadius: 12,
                offset: const Offset(0, -4),
              ),
            ],
          ),
          child: Column(
            children: [
              // Handle
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: CupertinoColors.systemGrey3.resolveFrom(context),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
              // Title bar
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Available Networks',
                          style: CupertinoTheme.of(context)
                              .textTheme
                              .navTitleTextStyle
                              .copyWith(
                                fontSize: 17,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                        if (widget.networks.isNotEmpty)
                          Text(
                            '${widget.networks.length} device${widget.networks.length == 1 ? '' : 's'}',
                            style:
                                CupertinoTheme.of(context).textTheme.textStyle
                                    .copyWith(
                              fontSize: 13,
                              color: CupertinoColors.systemGrey
                                  .resolveFrom(context),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              // Divider
              Container(
                height: 1,
                color: CupertinoColors.systemGrey5.resolveFrom(context),
              ),
              // Network list
              Expanded(
                child: widget.networks.isEmpty
                    ? CupertinoNetworkList(
                        networks: [],
                        onNetworkSelected: (_) {},
                      )
                    : SingleChildScrollView(
                        controller: scrollController,
                        child: CupertinoNetworkList(
                          networks: widget.networks,
                          onNetworkSelected: widget.onNetworkSelected,
                          isLoading: widget.isLoading,
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
