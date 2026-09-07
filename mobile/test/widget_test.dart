import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:copy_and_paste/main.dart';

void main() {
  testWidgets('Splash opens sign-in and validates empty credentials', (
    tester,
  ) async {
    await tester.pumpWidget(const MyApp());
    expect(find.text('Copy & Paste'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.text('Sign In'), findsWidgets);
    final signIn = find.widgetWithText(CupertinoButton, 'Sign In');
    await tester.ensureVisible(signIn);
    await tester.tap(signIn);
    await tester.pumpAndSettle();
    expect(find.text('Please enter email and password'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
