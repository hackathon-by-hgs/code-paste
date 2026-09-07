# Mobile Architecture

Clean, scalable Flutter architecture for the Copy & Paste mobile app.

## Folder Structure

```
lib/
├── main.dart                          App entry point
├── config/
│   ├── app_config.dart               App constants and configuration
│   └── app_theme.dart                Design tokens and theme
├── routes/
│   └── app_routes.dart               Navigation/routing configuration
├── screens/
│   ├── splash/
│   │   └── splash_screen.dart        Splash/loading screen
│   └── home/
│       └── home_screen.dart          Main home screen
├── services/
│   ├── clipboard_service.dart        Clipboard read/write operations
│   └── device_discovery_service.dart LAN device discovery
├── models/
│   └── device.dart                   Domain models
├── widgets/                           Reusable UI components
├── utils/
│   └── constants.dart                App-wide constants
└── (widgets, providers, etc. as needed)
```

## Architecture Principles

### Separation of Concerns
- **Screens** — UI and navigation only
- **Services** — Business logic and platform integration
- **Models** — Domain entities and data structures
- **Config** — App-wide constants and theming
- **Utils** — Helper functions and constants

### Scalability
- Easy to add new screens (create in `screens/` folder)
- Easy to add new services (create in `services/` folder)
- No reach-around imports across folders
- Services are abstracted (interface-based)

### Testability
- Services are abstract classes → easy to mock
- Business logic separated from UI
- Models have `fromJson`/`toJson` for testing

## Adding a New Screen

1. Create folder: `lib/screens/{screen_name}/`
2. Create `{screen_name}_screen.dart`
3. Add route to `AppRoutes.router` in `lib/routes/app_routes.dart`
4. Use consistent naming: `{NameType}Screen` for classes

Example:
```dart
// lib/screens/device_pairing/device_pairing_screen.dart
class DevicePairingScreen extends StatefulWidget { ... }
```

## Adding a New Service

1. Create interface in `lib/services/{service_name}.dart`
2. Create implementation class
3. Use abstract class for dependency injection later

Example:
```dart
// lib/services/auth_service.dart
abstract class AuthService {
  Future<void> login(String email, String password);
}

class AuthServiceImpl implements AuthService { ... }
```

## State Management

Currently using **Provider** (configured in pubspec.yaml).

To add state:
1. Create a ChangeNotifier class
2. Wrap it with ChangeNotifierProvider in main.dart or above the widget tree
3. Use `context.watch<YourProvider>()` in widgets

## Styling & Theme

All colors and text styles are centralized in:
- **Colors**: `lib/config/app_theme.dart` (AppTheme class)
- **Typography**: `lib/config/app_theme.dart` (TextTheme in lightTheme())
- **Constants**: `lib/config/app_config.dart` (AppConfig class)

Never hardcode colors or sizes. Always use:
```dart
// Good
Container(
  color: AppTheme.primaryColor,
  padding: const EdgeInsets.all(AppConfig.defaultPadding),
)

// Bad
Container(
  color: Color(0xFF2563EB),
  padding: const EdgeInsets.all(16),
)
```

## Platform Integration

Platform-specific code (iOS/Android) goes through:
- **Services** → Use MethodChannel to communicate with native code
- **Models** → Serialize platform responses to Dart models

Example structure:
```dart
// lib/services/clipboard_service.dart
class ClipboardServiceImpl implements ClipboardService {
  static const platform = MethodChannel('com.hgs.copypaste/clipboard');
  
  Future<String?> readText() async {
    return await platform.invokeMethod<String>('readText');
  }
}
```

## Next Steps

1. Wait for screen designs (mockups/screenshots)
2. Implement screens in `lib/screens/`
3. Add features to services
4. Implement state management with Provider
5. Add tests in `test/`
