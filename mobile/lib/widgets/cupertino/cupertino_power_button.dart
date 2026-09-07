import 'package:flutter/cupertino.dart';

class CupertinoPowerButton extends StatefulWidget {
  final bool isActive;
  final bool isLoading;
  final VoidCallback onPressed;
  final AnimationController animationController;
  final double size;

  const CupertinoPowerButton({
    super.key,
    required this.isActive,
    required this.isLoading,
    required this.onPressed,
    required this.animationController,
    this.size = 100,
  });

  @override
  State<CupertinoPowerButton> createState() => _CupertinoPowerButtonState();
}

class _CupertinoPowerButtonState extends State<CupertinoPowerButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 2000),
      vsync: this,
    );
    if (widget.isActive) {
      _pulseController.repeat();
    }
  }

  @override
  void didUpdateWidget(CupertinoPowerButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isActive && !_pulseController.isAnimating) {
      _pulseController.repeat();
    } else if (!widget.isActive && _pulseController.isAnimating) {
      _pulseController.stop();
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.isLoading ? null : widget.onPressed,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (widget.isActive)
            ScaleTransition(
              scale: Tween<double>(begin: 1.0, end: 1.3).animate(
                CurvedAnimation(parent: _pulseController, curve: Curves.easeOut),
              ),
              child: Container(
                width: widget.size,
                height: widget.size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: CupertinoColors.destructiveRed.withValues(alpha: 0),
                  border: Border.all(
                    color: CupertinoColors.destructiveRed.withValues(alpha: 0),
                    width: 3,
                  ),
                ),
              ),
            ),
          ScaleTransition(
            scale: Tween<double>(begin: 1.0, end: 0.95).animate(
              CurvedAnimation(
                parent: widget.animationController,
                curve: Curves.elasticOut,
              ),
            ),
            child: Container(
              width: widget.size,
              height: widget.size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.isActive
                    ? CupertinoColors.destructiveRed
                    : CupertinoColors.systemGrey5.resolveFrom(context),
                boxShadow: [
                  BoxShadow(
                    color: (widget.isActive
                            ? CupertinoColors.destructiveRed
                            : CupertinoColors.systemGrey5.resolveFrom(context))
                        .withValues(alpha: 0.4),
                    blurRadius: 20,
                    offset: const Offset(0, 6),
                    spreadRadius: widget.isActive ? 2 : 0,
                  ),
                  if (widget.isActive)
                    BoxShadow(
                      color: CupertinoColors.destructiveRed.withValues(
                        alpha: 0.15,
                      ),
                      blurRadius: 30,
                      offset: const Offset(0, 0),
                      spreadRadius: 8,
                    ),
                ],
              ),
              child: Center(
                child: widget.isLoading
                    ? SizedBox(
                        width: widget.size * 0.5,
                        height: widget.size * 0.5,
                        child: CupertinoActivityIndicator(
                          color: widget.isActive
                              ? CupertinoColors.white
                              : null,
                          radius: 12,
                        ),
                      )
                    : Icon(
                        widget.isActive
                            ? CupertinoIcons.checkmark_alt
                            : CupertinoIcons.power,
                        size: widget.size * 0.4,
                        color: widget.isActive
                            ? CupertinoColors.white
                            : CupertinoColors.label.resolveFrom(context),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
