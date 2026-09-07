import 'package:flutter/cupertino.dart';

class CupertinoPowerButton extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onPressed,
      child: ScaleTransition(
        scale: Tween<double>(begin: 1.0, end: 0.95).animate(
          CurvedAnimation(
            parent: animationController,
            curve: Curves.elasticOut,
          ),
        ),
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isActive
                ? CupertinoColors.destructiveRed
                : CupertinoColors.systemGrey5.resolveFrom(context),
            boxShadow: [
              BoxShadow(
                color:
                    (isActive
                            ? CupertinoColors.destructiveRed
                            : CupertinoColors.systemGrey5.resolveFrom(context))
                        .withValues(alpha: 0.3),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Center(
            child: isLoading
                ? SizedBox(
                    width: size * 0.5,
                    height: size * 0.5,
                    child: CupertinoActivityIndicator(
                      color: isActive ? CupertinoColors.white : null,
                      radius: 12,
                    ),
                  )
                : Icon(
                    isActive
                        ? CupertinoIcons.checkmark_alt
                        : CupertinoIcons.power,
                    size: size * 0.4,
                    color: isActive
                        ? CupertinoColors.white
                        : CupertinoColors.label.resolveFrom(context),
                  ),
          ),
        ),
      ),
    );
  }
}
