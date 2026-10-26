import 'package:copy_and_paste/main.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // App startup reads secure storage to decide where to route. Neither plugin
  // has a platform implementation under `flutter test`, so without these stubs
  // the router's redirect throws and the app renders nothing at all.
  const secureStorage = MethodChannel(
    'plugins.it_nomads.com/flutter_secure_storage',
  );
  const packageInfo = MethodChannel('dev.fluttercommunity.plus/package_info');

  setUp(() {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

    // No stored credentials: a fresh install.
    messenger.setMockMethodCallHandler(secureStorage, (call) async {
      switch (call.method) {
        case 'readAll':
          return <String, String>{};
        case 'containsKey':
          return false;
        default:
          return null;
      }
    });

    messenger.setMockMethodCallHandler(packageInfo, (call) async {
      return <String, dynamic>{
        'appName': 'copy_and_paste',
        'packageName': 'com.example.copy_and_paste',
        'version': '1.0.0',
        'buildNumber': '1',
      };
    });
  });

  tearDown(() {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(secureStorage, null);
    messenger.setMockMethodCallHandler(packageInfo, null);
  });

  testWidgets('starts unauthenticated on sign-in and validates empty input', (
    tester,
  ) async {
    await tester.pumpWidget(const MyApp());

    // With no stored tokens the router sends the splash route straight to
    // sign-in, so the first screen a new user sees is the sign-in form.
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();

    expect(find.text('Copy & Paste'), findsOneWidget);
    expect(find.text('Sign In'), findsWidgets);

    final signIn = find.widgetWithText(CupertinoButton, 'Sign In');
    await tester.ensureVisible(signIn);
    await tester.tap(signIn);
    await tester.pumpAndSettle();

    expect(find.text('Please enter email and password'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
