# Platform-Specific Permission Implementation

This document details how permissions are handled on iOS and Android.

## Architecture

```
Flutter (Dart)
    |
    | MethodChannel: "com.hgs.copypaste/permissions"
    |
    +------> iOS (Swift) <------+
    |        AppDelegate          |
    |                             |
    +------> Android (Kotlin) ----+
             MainActivity
```

## iOS Implementation

### File: `ios/Runner/AppDelegate.swift`

**Permissions Handled:**
1. **Local Network** (iOS 14+)
   - Uses `NWPathMonitor` to detect local network access
   - System shows permission dialog automatically
   - Required for mDNS/Bonjour device discovery

2. **Bluetooth** (iOS 13+)
   - Uses `CBCentralManager` for Bluetooth state detection
   - System shows permission dialog automatically
   - Required for peer connection establishment

3. **Notifications** (iOS 10+)
   - Uses `UNUserNotificationCenter`
   - Optional, for future sync notifications

### File: `ios/Runner/Info.plist`

**Required Keys:**
```
NSLocalNetworkUsageDescription
  → Explains why app needs local network access

NSBonjourServices
  → Declares Bonjour service: _copypaste._tcp

NSBluetoothPeripheralUsageDescription
  → Explains Bluetooth usage (iOS 12 and below)

NSBluetoothAlwaysAndWhenInUseUsageDescription
  → Explains Bluetooth usage (iOS 13+)
```

### Permission Flow

```
1. App calls requestLocalNetworkPermission()
   ↓
2. iOS MethodChannel → AppDelegate.requestLocalNetworkPermission()
   ↓
3. Creates NWPathMonitor
   ↓
4. System shows: "Copy & Paste wants to access your local network?"
   ↓
5. User grants → Returns true
   User denies → Returns false
```

### User Prompts (Exact Text)

**Local Network Dialog:**
```
"Copy & Paste" would like to find and connect to devices on your local network.

[Don't Allow]  [Allow]
```

**Bluetooth Dialog:**
```
"Copy & Paste" would like to access your Bluetooth devices.

[Don't Allow]  [Allow]
```

## Android Implementation

### File: `android/app/src/main/kotlin/com/hgs/copypaste/MainActivity.kt`

**Permissions Handled:**

1. **Local Network** (Android 12+)
   - `CHANGE_WIFI_STATE` permission
   - Required for local network broadcasting
   - Android 11 and below: Granted by default

2. **Bluetooth** (Android 5+)
   - Android 12+: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`
   - Android 11 and below: `BLUETOOTH`, `BLUETOOTH_ADMIN`
   - Required for device discovery and connection

3. **Notifications** (Android 13+)
   - `POST_NOTIFICATIONS` permission
   - Optional, for sync notifications
   - Android 12 and below: Granted by default

### File: `android/app/src/main/AndroidManifest.xml`

**Declared Permissions:**
```xml
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

### Permission Flow (Android 12+)

```
1. App calls requestBluetoothPermission()
   ↓
2. Android MethodChannel → MainActivity.requestBluetoothPermission()
   ↓
3. Check if BLUETOOTH_SCAN + BLUETOOTH_CONNECT are granted
   ↓
4. If not granted: ActivityCompat.requestPermissions()
   ↓
5. System shows: "Copy & Paste needs device and app history"
   (Or varies by permission)
   ↓
6. User grants → onRequestPermissionsResult() called
   User denies → onRequestPermissionsResult() called
```

### Scoped Storage Note

Android 12+ introduced scoped storage. For clipboard access:
- App can access its own clipboard
- Cannot access other apps' clipboards directly
- File sharing happens through content providers

This is handled separately in `clipboard_service.dart`.

## Security Considerations

### ✅ Implemented
1. Permissions are requested only when needed
2. User has explicit control via system dialogs
3. No permissions silently granted
4. Permission state tracked per OS
5. Graceful fallback if permission denied

### ⚠️ Future Work
1. Permission state caching (avoid re-requesting)
2. Retry logic if permissions change
3. Handling permission revocation
4. Monitoring permission changes at runtime

## Testing Permissions Locally

### iOS Testing

```bash
# Build for iOS simulator
cd mobile
flutter pub get
flutter run -d iPhone\ 16\ Pro

# Simulate permission prompt:
# - First tap of button will trigger permission request
# - Grant/deny in the system prompt
# - Observe button state change
```

**Simulator Notes:**
- Bluetooth permissions work in simulator
- Local network permissions limited in simulator
- Test on real device for full functionality

### Android Testing

```bash
# Build for Android emulator
cd mobile
flutter run -d emulator-5554

# Permission flow:
# - First tap requests permissions
# - Grant/deny in runtime permission dialog
# - Observe button state change
```

**Emulator Notes:**
- Bluetooth is limited in most emulators
- Local network access simulated
- Some tests require API 31+ emulator

## Handling Permission Changes

The current implementation assumes permissions granted once at startup.

**Future improvement (Phase 3):**
```dart
// Listen to permission changes
Stream<bool> permissionChanges = _permissionService.onPermissionChanged();

permissionChanges.listen((granted) {
  if (!granted) {
    // Permission revoked - disable feature
    disableFeature();
  }
});
```

## Error Handling

If a permission request fails:

```dart
Future<bool> requestPermission() async {
  try {
    return await platform.invokeMethod<bool>('requestXXX') ?? false;
  } catch (e) {
    print('Permission error: $e');
    return false;
  }
}
```

All errors are caught and return `false`, which disables the feature.

## Platform Version Support

| Feature | iOS | Android |
|---------|-----|---------|
| Local Network | 14+ | 12+ |
| Bluetooth | 13+ | 5+ |
| Notifications | 10+ | 8+ |
| Fallback | Graceful | Graceful |

For older versions, permissions are either:
1. Granted by default
2. Always on (system-managed)
3. Feature disabled gracefully

## Next Steps

1. ✅ Permission dialogs implemented
2. ⏳ Device discovery (mDNS) implementation
3. ⏳ Connection establishment
4. ⏳ Clipboard integration
5. ⏳ Testing on real devices
