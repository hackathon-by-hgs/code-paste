import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:copy_and_paste/models/network.dart';
import 'package:copy_and_paste/widgets/cupertino/cupertino_bottom_sheet.dart';

void main() {
  for (final hasDevices in [false, true]) {
    testWidgets('handle expands and collapses sheet with devices=$hasDevices', (
      tester,
    ) async {
      await tester.pumpWidget(
        CupertinoApp(
          home: CupertinoPageScaffold(
            child: CupertinoBottomSheet(
              networks: hasDevices
                  ? [
                      Network(
                        id: '1',
                        name: 'Laptop',
                        status: ConnectionStatus.available,
                        signalStrength: SignalStrength.good,
                        isCurrentlyConnected: false,
                      ),
                    ]
                  : [],
              onNetworkSelected: (_) {},
            ),
          ),
        ),
      );
      final handle = find.byKey(const ValueKey('network-sheet-handle'));
      final initialY = tester.getTopLeft(handle).dy;
      await tester.drag(handle, const Offset(0, -250));
      await tester.pumpAndSettle();
      final expandedY = tester.getTopLeft(handle).dy;
      expect(expandedY, lessThan(initialY - 100));
      expect(tester.takeException(), isNull);
      await tester.drag(handle, const Offset(0, 350));
      await tester.pumpAndSettle();
      expect(tester.getTopLeft(handle).dy, greaterThan(expandedY + 100));
      expect(tester.takeException(), isNull);
    });
  }
}
