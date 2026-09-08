import 'package:flutter/cupertino.dart';
import '../services/app_update_service.dart';

class UpdatePrompt extends StatefulWidget {
  final AppUpdate update;
  final VoidCallback onUpdate;
  final VoidCallback? onLater;

  const UpdatePrompt({
    super.key,
    required this.update,
    required this.onUpdate,
    this.onLater,
  });

  @override
  State<UpdatePrompt> createState() => _UpdatePromptState();
}

class _UpdatePromptState extends State<UpdatePrompt> {
  bool _isLoading = false;

  Future<void> _handleUpdate() async {
    setState(() => _isLoading = true);
    try {
      widget.onUpdate();
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoAlertDialog(
      title: const Text('App Update Available'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 12),
          Text(
            'Version ${widget.update.version} is now available',
            style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: CupertinoColors.systemGrey6,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              widget.update.releaseNotes,
              style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                    fontSize: 13,
                    color: CupertinoColors.systemGrey,
              ),
            ),
          ),
          if (widget.update.isCritical) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: CupertinoColors.systemRed.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                'Critical Update - Please update immediately',
                style: CupertinoTheme.of(context).textTheme.textStyle.copyWith(
                      fontSize: 12,
                      color: CupertinoColors.systemRed,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
          ],
        ],
      ),
      actions: [
        if (!widget.update.isCritical && widget.onLater != null)
          CupertinoDialogAction(
            onPressed: () {
              Navigator.pop(context);
              widget.onLater?.call();
            },
            child: const Text('Later'),
          ),
        CupertinoDialogAction(
          isDefaultAction: true,
          onPressed: _isLoading ? null : _handleUpdate,
          child: _isLoading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CupertinoActivityIndicator(),
                )
              : const Text('Update Now'),
        ),
      ],
    );
  }
}
