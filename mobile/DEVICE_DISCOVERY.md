# Device Discovery & Cupertino UI Implementation

## Overview

Complete redesign from Material Design to native Apple Cupertino styling with full device discovery workflow.

## Architecture

### State Machine

```
initializing
    ↓
ready ←─────────┐
    ↓          │
activating      │ (Tap to disable)
    ↓          │
active ────→ scanning
    ├──────────┘
    ↓
connecting → connected
    ↓
    └──→ connectionFailed → (back to active)
```

### State Definitions

```dart
enum AppLifecycleState {
  initializing,      // App loading
  permissionRequired, // Permissions missing
  ready,            // Ready to activate
  activating,       // Requesting permissions
  active,           // Feature active, ready for discovery
  scanning,         // Discovering devices
  connecting,       // Connecting to network
  connected,        // Successfully connected
  connectionFailed, // Connection error
  deactivating,     // Turning off
  error,            // Fatal error
}
```

## Device Discovery

### LocalDeviceDiscovery Service

**Location:** `lib/services/local_device_discovery.dart`

**Responsibilities:**
- Scan local network for compatible devices
- Emit discovered devices via Stream
- Manage scan lifecycle (start/stop)
- Handle mDNS/Bonjour queries

**Current Implementation:** Mock discovery (MVP)
- Simulates 3 devices: MacBook Pro, iMac, iPad
- Random discovery with 500ms polling interval
- Real mDNS: Future implementation via platform channels

**Future Real Implementation:**
```
iOS: NSNetServiceBrowser + NSNetService
Android: NsdManager (Network Service Discovery)
```

### Discovery Flow

```
1. User taps power button (OFF → ON)
   ↓
2. Check permissions
   ↓
3. If not granted → request via native dialogs
   ↓
4. Permissions granted → activate feature
   ↓
5. State: active
   ↓
6. Auto-start discovery (State: scanning)
   ↓
7. Listen to discovery stream
   ↓
8. Devices appear in bottom sheet list
   ↓
9. User taps device → connect
```

## UI Components

### HomeScreenCupertino

**Location:** `lib/screens/home/home_screen_cupertino.dart`

**Structure:**
```
CupertinoPageScaffold
├── CupertinoNavigationBar (title bar)
├── Stack
│   ├── Center (power button)
│   ├── Error message (conditional)
│   └── CupertinoBottomSheet (networks)
```

**State-Driven Rendering:**
- Entire UI updates based on `HomeProvider` state
- No manual widget manipulation
- Clean separation of concerns

### CupertinoPowerButton

**Location:** `lib/widgets/cupertino/cupertino_power_button.dart`

**Features:**
- Circular button (100x100px default)
- Two visual states:
  - OFF: System grey (systemGrey5)
  - ON: Apple red (destructiveRed)
- Icons:
  - OFF: `CupertinoIcons.power`
  - ON: `CupertinoIcons.checkmark_alt`
- Loading state: Spinning `CupertinoActivityIndicator`
- Animations:
  - Scale: 1.0 → 0.95 on tap (elastic out)
  - Color transition (immediate)
  - Icon transition (immediate)

**Haptic Feedback:**
- Light impact on successful activation
- Medium impact on activation success
- Optional on state changes

**Shadow:**
- 16px blur radius
- Offset: (0, 4)
- 30% opacity
- Color matches button color

### CupertinoBottomSheet

**Location:** `lib/widgets/cupertino/cupertino_bottom_sheet.dart`

**Features:**
- `DraggableScrollableSheet` with three snap positions
- Snap positions:
  - Collapsed: 15% (just shows handle + title)
  - Medium: 50% (partial list visible)
  - Expanded: 85% (full list)

**Components:**
```
┌─────────────────────┐
│   ───── (handle)    │  ← 36x4 drag handle
│                     │
│ Available Networks  │  ← Title
│ 3 devices          │  ← Device count
├─────────────────────┤
│ [Network List]      │  ← CupertinoListSection.insetGrouped
│  - MacBook Pro      │
│  - iMac             │
│  - iPad             │
└─────────────────────┘
```

**Behavior:**
- Follows user finger directly (drag gesture)
- Spring physics for snap animation
- Scrollable network list when expanded
- Smooth transitions between snap positions

### CupertinoNetworkList

**Location:** `lib/widgets/cupertino/cupertino_network_list.dart`

**Each Network Row:**
```
[Icon] | Name           | Signal | Checkmark
                        | Status | or Chevron
```

**Elements:**
- Icon: `CupertinoIcons.device_desktop` (colored by connection state)
- Name: Network/device name
- Signal bars: 4-bar visual indicator (1-4 filled)
- Signal label: "Poor", "Fair", "Good", "Excellent"
- Status: Green "Connected" text for active network
- Trailing: Green checkmark (if connected) or grey chevron (if available)

**Styling:**
- Uses `CupertinoListTile` (native grouping)
- `CupertinoListSection.insetGrouped` for proper margins
- Automatic separator lines
- System spacing and corner radii

## Interaction Flow

### Activation (OFF → ON)

```
User taps power button
    ↓
Provider.toggleFeature()
    ↓
State: activating
Button: spinning loader
    ↓
Request permissions (native dialogs)
    ↓
If denied:
    ├─ State: permissionRequired
    ├─ Error message: "Permissions Required"
    └─ User can tap "Try Again"
    
If granted:
    ├─ Haptic: medium impact
    ├─ State: active
    ├─ Button: animates to red with checkmark
    ├─ Status text: "Connected"
    └─ Auto-start discovery (State: scanning)
```

### Discovery (Scanning)

```
State: scanning
    ↓
LocalDeviceDiscovery.discoverDevices()
    ↓
Listen to discovery stream
    ↓
For each discovered device:
    ├─ Add to network list
    ├─ Emit via stream
    └─ Update UI
    ↓
After 3 seconds or 3 devices found:
    ├─ Stop discovery
    └─ State: active
```

### Connection

```
User taps network in list
    ↓
State: connecting
Selected row: loading spinner
    ↓
Simulate connection delay (1 second)
    ↓
If success:
    ├─ Haptic: medium impact
    ├─ Update network status to "Connected"
    ├─ Show green checkmark
    ├─ Disconnect previous network
    ├─ _connectedNetwork = selected
    └─ State: active
    
If failure:
    ├─ State: active
    ├─ Error message: "Connection Failed"
    └─ Network remains available
```

### Deactivation (ON → OFF)

```
User taps power button (while active)
    ↓
Provider.toggleFeature()
    ↓
State: deactivating
Button: animates back to grey
    ↓
Stop discovery
Clear network list
Clear connected network
    ↓
Haptic: light impact
    ↓
State: ready
```

## Cupertino Design Principles

### Visual Style
- System black background on splash
- White/system grey backgrounds on main UI
- Apple system red for active state
- SF Symbols only (no custom icons)
- Proper use of system colors:
  - `systemBackground`
  - `systemGrey`, `systemGrey3`, `systemGrey5`
  - `systemGreen` (for connected)
  - `destructiveRed` (for active)

### Spacing
- 16pt margins (standard)
- 12pt between elements
- 8pt fine spacing
- 4pt handle size
- System-enforced safe areas

### Typography
- `navLargeTitleTextStyle` for main titles
- `navTitleTextStyle` for section headers
- `textStyle` for body text
- SF Pro Display font (system default)
- Proper font weights: 600 (titles), 500 (labels), 400 (body)

### Animations
- 300-800ms durations
- Spring physics for drag/snap
- Ease out for entries
- No overly complex animations
- Minimal easing functions

### Interactions
- Haptic feedback on state changes
- Direct tracking of finger (drag)
- Responsive button states
- Natural spring behavior
- Clear loading indicators

## Error Handling

### Error States

```dart
class AppError {
  final String message;      // "Connection Failed"
  final String? details;     // Optional explanation
  final bool recoverable;    // Can user retry?
}
```

### Error Messages

**Permission Denied:**
```
"Permissions Required"
"Local network and Bluetooth access are needed."
[Try Again]
```

**Discovery Failed:**
```
"Discovery Error"
"Failed to discover devices."
[Try Again]
```

**Connection Failed:**
```
"Connection Failed"
"Unable to connect to the network."
(No retry - user can tap another network)
```

### Error Display
- Red background (destructiveRed)
- White text
- Close button (X) to dismiss
- "Try Again" button if recoverable
- Non-blocking (appears above bottom sheet)

## Testing

### Manual Testing

1. **Permissions Flow:**
   - Tap power button → System dialogs appear
   - Grant permissions → Button turns red
   - Deny permissions → Error message, button stays grey

2. **Discovery:**
   - With power ON → Bottom sheet appears
   - Devices discovered → Network list populates
   - Swipe sheet → Snap to positions

3. **Connection:**
   - Tap network → Loading spinner
   - Success → Checkmark, "Connected" label
   - Other networks show chevron

4. **Deactivation:**
   - Tap red button → Button animates to grey
   - Bottom sheet disappears
   - All state resets

### Platform-Specific Testing

**iOS (Real Device or Simulator):**
```bash
flutter run -d <device-name>
```

**Android (Emulator or Device):**
```bash
flutter run -d <emulator-name>
```

## Next Steps

1. **Real mDNS Implementation** (Phase 3)
   - Replace mock discovery with platform channels
   - iOS: NSNetServiceBrowser
   - Android: NsdManager

2. **Peer Connection** (Phase 4)
   - Establish encrypted LAN channel
   - Handle connection state on network side

3. **Clipboard Integration** (Phase 4)
   - Read OS clipboard
   - Write received payloads
   - Sync across connected device

4. **Refinement** (Phase 5)
   - Error recovery
   - Connection retry logic
   - UI Polish and accessibility

## Files Changed

```
lib/models/
  └─ app_state.dart          NEW: State machine enums

lib/services/
  ├─ local_device_discovery.dart    NEW: Device discovery
  ├─ permission_service.dart        UPDATED: Haptic feedback
  └─ device_discovery_service.dart  DEPRECATED (for now)

lib/providers/
  └─ home_provider.dart      MAJOR: Complete refactor

lib/screens/
  ├─ home/home_screen_cupertino.dart  NEW: Cupertino UI
  ├─ home/home_screen.dart           DEPRECATED (Material)
  └─ splash/splash_screen.dart       UPDATED: Cupertino style

lib/widgets/
  ├─ cupertino/
  │  ├─ cupertino_power_button.dart   NEW
  │  ├─ cupertino_network_list.dart   NEW
  │  ├─ cupertino_bottom_sheet.dart   NEW
  │  └─ ... (other new Cupertino widgets)
  └─ ... (old Material widgets, can be removed)

lib/
  ├─ main.dart              UPDATED: CupertinoApp
  └─ routes/app_routes.dart UPDATED: Use Cupertino screen
```

## Summary

Full Apple Cupertino redesign with proper state machine, device discovery, and native iOS interactions. The app now feels like a real Apple system utility with clean, minimal interface and natural spring-based animations.
