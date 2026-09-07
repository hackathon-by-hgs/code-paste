# Home Screen Implementation Summary

## Visual Layout

```
┌─────────────────────────────────┐
│  Copy & Paste                   │
├─────────────────────────────────┤
│                                 │
│                                 │
│   Enable Clipboard Sync         │
│   Tap to enable and set         │
│   permissions                   │
│                                 │
│          ⭕ (Power Button)       │
│          🔴 OFF (gray)          │
│                                 │
│                                 │
├─────────────────────────────────┤
│  ─────  (drag handle)           │ ← Draggable Bottom Sheet
│  Available Networks             │
│  ┌─────────────────────────┐   │
│  │ 📱 My Desktop           │   │
│  │ Available • Good Signal │   │
│  │ ▓▓▓░ Good              │   │
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ 💻 MacBook              │   │
│  │ Connected ✓ Excellent   │   │
│  │ ▓▓▓▓ Excellent         │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

## Interaction States

### State 1: Initial (Feature OFF)
```
┌──────────────────────────────┐
│ Enable Clipboard Sync        │
│ Tap to enable and set        │
│ permissions                  │
│                              │
│      🔘 (gray button)        │ ← Disabled state
│      ⭕ Power icon           │
│                              │
│ Bottom Sheet: Hidden         │
└──────────────────────────────┘
```

**User Action**: Tap the gray power button
**Result**: Request system permissions dialog appears

### State 2: Requesting Permissions
```
┌──────────────────────────────┐
│ Enable Clipboard Sync        │
│ Requesting permissions...    │
│                              │
│      🔘 (loading spinner)    │ ← Loading state
│      ⟳ Rotating              │
│                              │
│ System permission dialog     │
│ "Allow local network access?"│
│ "Allow Bluetooth access?"    │
└──────────────────────────────┘
```

**System Prompts**:
- iOS: Local network access (NSLocalNetworkUsageDescription)
- Android: Nearby devices Bluetooth permission
- Optional: Notification permission

**User Action**: Grant permissions
**Result**: Permissions granted, feature enables automatically

### State 3: Active (Feature ON)
```
┌──────────────────────────────┐
│ Clipboard Sync               │
│ Sync is active and ready     │
│                              │
│      🔴 (red button)         │ ← Enabled state with glow
│      ✓ Checkmark icon        │ ← Glow effect visible
│      ⭕ Halo/glow            │
│                              │
│ ┌──────────────────────────┐│← Bottom sheet auto-visible
│ │ ─────  Available Networks││
│ │ 📱 My Desktop            ││
│ │ 📱 My iPhone             ││
│ └──────────────────────────┘│
└──────────────────────────────┘
```

**Automatic Action**: Network discovery starts
**Result**: Discovered networks appear in bottom sheet

### State 4: Bottom Sheet Expanded
```
┌──────────────────────────────┐
│ Clipboard Sync               │
│ Sync is active               │
│                              │
│      🔴 (red, still visible) │
│                              │
│ ╔══════════════════════════╗ │
│ ║ ─────  (drag handle)     ║ │← Fully expanded
│ ║ Available Networks   ↻   ║ │
│ ╠══════════════════════════╣ │
│ ║ ┌──────────────────────┐ ║ │
│ ║ │ 📱 My Desktop        │ ║ │
│ ║ │ Available • Good (▓▓▓)│ ║ │
│ ║ │ Connection → > > >   │ ║ │
│ ║ └──────────────────────┘ ║ │
│ ║ ┌──────────────────────┐ ║ │
│ ║ │ 💻 MacBook           │ ║ │
│ ║ │ Connected ✓ Excellent│ ║ │
│ ║ │ Connection ✓ ✓ ✓ ✓ ✓ │ ║ │
│ ║ └──────────────────────┘ ║ │
│ ║ ┌──────────────────────┐ ║ │
│ ║ │ 📱 iPhone            │ ║ │
│ ║ │ Available • Fair     │ ║ │
│ ║ │ Connection ▓▓░       │ ║ │
│ ║ └──────────────────────┘ ║ │
│ ╚══════════════════════════╝ │
└──────────────────────────────┘
```

**User Action**: 
- Swipe down to collapse → back to collapsed state
- Tap network → Initiate connection
- Tap refresh icon → Re-discover networks

## Visual Elements

### Power Button States

#### OFF (Initial)
- **Color**: Gray (#9CA3AF)
- **Icon**: Power icon (🔘)
- **Size**: 120x120px
- **Shadow**: Subtle gray shadow
- **Animation**: None

#### LOADING (Requesting Permissions)
- **Color**: Gray (#9CA3AF)
- **Icon**: Rotating spinner
- **Animation**: Continuous rotation
- **Interaction**: Tap disabled

#### ON (Active)
- **Color**: Red (#EF4444)
- **Icon**: Checkmark (✓)
- **Size**: 120x120px
- **Shadow**: Red glow shadow
- **Animation**: Scale + rotation on first enable
- **Glow**: Red halo that pulses

### Network Items

Each network shows:
- **Icon**: Device type icon
- **Name**: Network/device name (truncated if long)
- **Status Badge**: "Connected" (green) or "Available" (gray)
- **Signal Strength**: Visual bar indicator (1-4 bars)
- **Right Icon**: 
  - Checkmark (✓) if connected
  - Loading spinner if connecting
  - Arrow (→) if available

### Bottom Sheet

- **Height Range**: 15% (collapsed) to 85% (expanded)
- **Snap Points**: Auto-snaps to collapsed or expanded
- **Drag Handle**: Visual indicator at top
- **Background**: White with rounded corners (20px radius)
- **Shadow**: Lifted appearance with box shadow

### Error Messages

Appears at bottom center if needed:
- **Background**: Red (#EF4444)
- **Text**: White
- **Position**: Above bottom sheet (if visible)
- **Auto-dismiss**: Optional close button
- **Animation**: Slide up

## Component Structure

```
HomeScreen
├── AppBar
│   └── Title: "Copy & Paste"
├── Stack (main content)
│   ├── Center (power button area)
│   │   ├── Status text
│   │   └── PowerButton
│   │       ├── Glow effect (if enabled)
│   │       └── Scale animation
│   ├── Error message (conditionally)
│   └── NetworksBottomSheet
│       ├── Drag handle
│       ├── Header (title + refresh)
│       └── NetworksList
│           └── NetworkItem (repeated)
```

## User Flows

### Flow 1: Enable Feature → Grant Permissions
```
1. User sees gray OFF button
   ↓
2. Tap button
   ↓
3. Permission dialog appears
   ↓
4. User grants permissions
   ↓
5. Button turns red (animation)
   ↓
6. Status text changes to "Clipboard Sync - Sync is active and ready"
   ↓
7. Bottom sheet becomes visible (collapsed)
   ↓
8. Discovery starts automatically
   ↓
9. Networks appear in bottom sheet
```

### Flow 2: Deny Permissions
```
1. User sees gray OFF button
   ↓
2. Tap button
   ↓
3. Permission dialog appears
   ↓
4. User denies permissions
   ↓
5. Error message appears: "Permissions denied. Please enable them in settings."
   ↓
6. Button remains gray
   ↓
7. User can tap again to retry
```

### Flow 3: Connect to Network
```
1. Feature is ON
   ↓
2. Bottom sheet is expanded
   ↓
3. User taps a network
   ↓
4. Loading spinner appears on that network item
   ↓
5. Connection attempt in progress
   ↓
6. Success: Item shows checkmark, status changes to "Connected"
   ↓
7. Or Error: Toast message appears
```

### Flow 4: Disable Feature
```
1. Feature is ON (red button)
   ↓
2. User taps button again
   ↓
3. Animation plays (scale, rotation)
   ↓
4. Button turns gray
   ↓
5. Bottom sheet disappears
   ↓
6. Status text: "Enable Clipboard Sync - Tap to enable..."
   ↓
7. Feature disabled
```

## Key Design Decisions

✅ **Large central power button** - Makes the primary action obvious  
✅ **Red for ON, Gray for OFF** - Instant visual understanding  
✅ **Draggable bottom sheet** - Keeps networks hidden when not needed  
✅ **Auto-discovery on enable** - No extra steps for user  
✅ **Signal strength visualization** - Users understand network quality  
✅ **Connected status prominent** - Clear which network is active  
✅ **Minimal error states** - Only shows errors that need action  
✅ **Smooth animations** - Polish and feedback without distraction  

## Next Steps

1. ✅ Architecture implemented
2. ✅ Screen layout implemented
3. ⏳ Native permission handling (iOS/Android platform channels)
4. ⏳ Actual device discovery implementation
5. ⏳ Connection logic implementation
6. ⏳ Testing and refinement
