# Android Companion App Design

> DroidClaw Android app: the eyes and hands of the AI agent. Connects to the Hono server via WebSocket, captures accessibility trees and screenshots, executes gestures on command, and supports device-initiated goals.

**Date:** 2026-02-17
**Scope:** Full v1 (all 4 phases)
**Package:** `com.thisux.droidclaw`

---

## Architecture Overview

Three independent layers with clear boundaries:

```
┌──────────────────────────────────────────────┐
│                 UI Layer                      │
│  MainActivity + Compose (Home, Settings, Logs)│
│  Observes StateFlows from services            │
├──────────────────────────────────────────────┤
│              Connection Layer                 │
│  ConnectionService (foreground service)       │
│  ReliableWebSocket (Ktor) + CommandRouter     │
├──────────────────────────────────────────────┤
│             Accessibility Layer               │
│  DroidClawAccessibilityService (system svc)   │
│  ScreenTreeBuilder + GestureExecutor          │
│  ScreenCaptureManager (MediaProjection)       │
└──────────────────────────────────────────────┘
```

- **Accessibility Layer**: System-managed service. Reads screen trees, executes gestures, captures screenshots. Runs independently of app UI.
- **Connection Layer**: Foreground service with Ktor WebSocket. Bridges accessibility to server. Handles reconnection, heartbeat, message queuing.
- **UI Layer**: Compose with bottom nav. Observes service state via `StateFlow`. Goal input, settings, logs.

---

## Project Structure

```
android/app/src/main/java/com/thisux/droidclaw/
├── DroidClawApp.kt                    # Application class (DataStore init)
├── MainActivity.kt                     # Compose host + bottom nav
├── accessibility/
│   ├── DroidClawAccessibilityService.kt  # System service, tree capture
│   ├── ScreenTreeBuilder.kt              # NodeInfo → UIElement list
│   └── GestureExecutor.kt               # Node-first actions + dispatchGesture fallback
├── connection/
│   ├── ConnectionService.kt              # Foreground service, Ktor WebSocket
│   ├── ReliableWebSocket.kt             # Reconnect, heartbeat, message queue
│   └── CommandRouter.kt                  # Dispatches server commands → GestureExecutor
├── capture/
│   └── ScreenCaptureManager.kt          # MediaProjection screenshots
├── model/
│   ├── UIElement.kt                      # Mirrors @droidclaw/shared types
│   ├── Protocol.kt                       # WebSocket message types
│   └── AppState.kt                       # Connection status, steps, etc.
├── data/
│   └── SettingsStore.kt                  # DataStore for API key, server URL
├── ui/
│   ├── screens/
│   │   ├── HomeScreen.kt                 # Status + goal input + live log
│   │   ├── SettingsScreen.kt             # API key, server URL, battery opt
│   │   └── LogsScreen.kt                # Step history
│   └── theme/                            # Existing Material 3 theme
└── util/
    ├── BatteryOptimization.kt            # OEM-specific exemption helpers
    └── DeviceInfo.kt                     # Model, Android version, screen size
```

---

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| `io.ktor:ktor-client-cio` | 3.1.x | HTTP/WebSocket client (coroutine-native) |
| `io.ktor:ktor-client-websockets` | 3.1.x | WebSocket plugin for Ktor |
| `org.jetbrains.kotlinx:kotlinx-serialization-json` | 1.7.x | JSON serialization |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | 1.9.x | Coroutines |
| `androidx.datastore:datastore-preferences` | 1.1.x | Persistent settings (API key, server URL) |
| `androidx.lifecycle:lifecycle-service` | 2.8.x | Service lifecycle |
| `androidx.navigation:navigation-compose` | 2.8.x | Bottom nav routing |
| `androidx.compose.material:material-icons-extended` | latest | Nav icons |

---

## Permissions

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

Plus the accessibility service declaration:
```xml
<service
    android:name=".accessibility.DroidClawAccessibilityService"
    android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
    android:exported="false">
    <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
    </intent-filter>
    <meta-data
        android:name="android.accessibilityservice"
        android:resource="@xml/accessibility_config" />
</service>
```

---

## Layer 1: Accessibility Service

### DroidClawAccessibilityService

System-managed service. Android starts/stops it based on user toggling it in Settings > Accessibility.

**State exposed via companion StateFlow** (no binding needed):
```kotlin
companion object {
    val isRunning = MutableStateFlow(false)
    val lastScreenTree = MutableStateFlow<List<UIElement>>(emptyList())
    var instance: DroidClawAccessibilityService? = null
}
```

**Lifecycle:**
- `onServiceConnected()`: Set `isRunning = true`, store `instance`
- `onAccessibilityEvent()`: Capture events for window changes, content changes
- `onInterrupt()` / `onDestroy()`: Set `isRunning = false`, clear `instance`

### ScreenTreeBuilder

Walks `rootInActiveWindow` depth-first, extracts:
- Bounds (Rect), center coordinates (x, y)
- text, contentDescription, className, viewIdResourceName
- State flags: enabled, checked, focused, scrollable, clickable, longClickable
- Parent context (parent class, parent description)

**Output:** `List<UIElement>` matching `@droidclaw/shared` UIElement type.

**Null handling:** `rootInActiveWindow` returns null during screen transitions. Retry with exponential backoff (50ms, 100ms, 200ms) up to 3 attempts. If still null, return empty list (server uses vision fallback).

**Memory safety:** `AccessibilityNodeInfo` must be recycled. Use extension:
```kotlin
inline fun <T> AccessibilityNodeInfo.use(block: (AccessibilityNodeInfo) -> T): T {
    try { return block(this) } finally { recycle() }
}
```

**Screen hash:** `computeScreenHash()` — hash of element IDs + text + centers. Used by server for stuck-loop detection.

### GestureExecutor

Node-first strategy for all actions:

| Action | Primary (node) | Fallback (gesture) |
|--------|----------------|-------------------|
| tap | `performAction(ACTION_CLICK)` on node at (x,y) | `dispatchGesture()` tap at coordinates |
| type | `performAction(ACTION_SET_TEXT)` on focused node | Character-by-character gesture taps |
| long_press | `performAction(ACTION_LONG_CLICK)` | `dispatchGesture()` hold 1000ms |
| swipe | — | `dispatchGesture()` path from start→end |
| scroll | `performAction(ACTION_SCROLL_FORWARD/BACKWARD)` on scrollable parent | Swipe gesture |
| back | `performGlobalAction(GLOBAL_ACTION_BACK)` | — |
| home | `performGlobalAction(GLOBAL_ACTION_HOME)` | — |
| notifications | `performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)` | — |
| launch | `startActivity(packageManager.getLaunchIntentForPackage())` | — |
| clear | Focus node → select all → delete | — |
| enter | `performAction(ACTION_IME_ENTER)` or keyevent KEYCODE_ENTER | — |

**Result reporting:** Each action returns `ActionResult { success: Boolean, error: String? }`.

---

## Layer 2: Connection Service

### ConnectionService

Foreground service with persistent notification.

**Lifecycle:**
1. User taps "Connect" → service starts
2. Reads API key + server URL from DataStore
3. Creates `ReliableWebSocket` and connects
4. Notification shows: "DroidClaw - Connected to server" (or "Reconnecting...")
5. Notification has "Disconnect" action button
6. Service stops when user disconnects or notification action tapped

**State exposed:**
```kotlin
companion object {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val currentSteps = MutableStateFlow<List<AgentStep>>(emptyList())
    val currentGoalStatus = MutableStateFlow<GoalStatus>(GoalStatus.Idle)
    var instance: ConnectionService? = null
}
```

### ReliableWebSocket

Wraps Ktor `WebSocketSession` with reliability:

- **Connect:** `HttpClient { install(WebSockets) }` → `client.webSocket(serverUrl + "/ws/device")`
- **Auth handshake:** First message: `{ type: "auth", apiKey: "dc_xxx", deviceInfo: { model, android, screenWidth, screenHeight } }`
- **Wait for:** `{ type: "auth_ok", deviceId: "uuid" }` or `{ type: "auth_error" }` → close + surface error
- **Heartbeat:** Ktor WebSocket has built-in ping/pong. Configure `pingIntervalMillis = 30_000`
- **Reconnect:** On connection loss, exponential backoff: 1s → 2s → 4s → 8s → max 30s. Reset backoff on successful auth.
- **Message queue:** `Channel<String>(Channel.BUFFERED)` for outbound messages. Drained when connected, buffered when disconnected.
- **State:** Emits `ConnectionState` (Disconnected, Connecting, Connected, Error(message))

### CommandRouter

Receives JSON from WebSocket, parses, dispatches:

```
"get_screen"    → ScreenTreeBuilder.capture() → send screen response
"get_screenshot"→ ScreenCaptureManager.capture() → compress, base64, send
"execute"       → GestureExecutor.execute(action) → send result response
"ping"          → send { type: "pong" }
"goal_started"  → update UI state to running
"step"          → append to currentSteps, update UI
"goal_completed"→ update UI state to completed
"goal_failed"   → update UI state to failed
```

All responses include the `requestId` from the command for server-side Promise resolution.

---

## Layer 3: Screen Capture

### ScreenCaptureManager

MediaProjection-based screenshot capture.

**Setup:**
1. Request `MediaProjection` via `MediaProjectionManager.createScreenCaptureIntent()`
2. User grants consent (Android system dialog)
3. Create `VirtualDisplay` → `ImageReader` (RGBA_8888)
4. Keep projection alive in ConnectionService scope

**Capture flow:**
1. Server requests screenshot
2. Acquire latest `Image` from `ImageReader`
3. Convert to `Bitmap`
4. Scale to max 720px width (maintain aspect ratio)
5. Compress to JPEG quality 50
6. Return `ByteArray`

**Edge cases:**
- **Android 14+:** Per-session consent. Projection dies if user revokes or after reboot. Re-prompt on next connect.
- **FLAG_SECURE:** Returns black frame. Detect by checking if all pixels are black (sample corners). Report `error: "secure_window"` to server.
- **Projection unavailable:** Graceful degradation. Server works with accessibility tree only (vision fallback without actual screenshot).

---

## Layer 4: Data & Settings

### SettingsStore

Preferences DataStore for persistent settings:

| Key | Type | Default |
|-----|------|---------|
| `api_key` | String | `""` |
| `server_url` | String | `"wss://localhost:8080"` |
| `device_name` | String | Device model name |
| `auto_connect` | Boolean | `false` |

Exposed as `Flow<T>` for reactive UI updates.

---

## Layer 5: UI

### Navigation

Bottom nav with 3 tabs:
- **Home** (icon: `Home`) — connection status, goal input, live steps
- **Settings** (icon: `Settings`) — API key, server URL, permissions checklist
- **Logs** (icon: `History`) — past session history

### HomeScreen

```
┌─────────────────────────────┐
│  ● Connected to server       │  ← status badge (green/yellow/red)
├─────────────────────────────┤
│  [Enter a goal...    ] [Run] │  ← goal input + submit
├─────────────────────────────┤
│  Step 1: tap (540, 800)     │  ← live step log
│  "Tapping the search icon"  │
│                              │
│  Step 2: type "lofi beats"  │
│  "Typing the search query"  │
│                              │
│  ✓ Goal completed (5 steps) │  ← final status
└─────────────────────────────┘
```

- Goal input disabled when not connected or when a goal is running
- Steps stream in real-time via `ConnectionService.currentSteps` StateFlow
- Status transitions: idle → running → completed/failed

### SettingsScreen

```
┌─────────────────────────────┐
│  API Key                     │
│  [dc_••••••••••••••]  [Edit]│
├─────────────────────────────┤
│  Server URL                  │
│  [wss://your-server.app   ] │
├─────────────────────────────┤
│  Setup Checklist             │
│  ✓ API key configured        │
│  ✗ Accessibility service     │  ← tap to open Android settings
│  ✗ Screen capture permission │  ← tap to grant
│  ✓ Battery optimization off  │
└─────────────────────────────┘
```

- Warning cards for missing setup items
- Deep-links to Android system settings for accessibility toggle
- Battery optimization request via `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

### LogsScreen

- In-memory list of past sessions: goal text, step count, success/failure, timestamp
- Tap to expand → shows all steps with action + reasoning
- Clears on app restart (persistent storage is v2)

---

## WebSocket Protocol (Device Side)

### Device → Server

| Message | When |
|---------|------|
| `{ type: "auth", apiKey, deviceInfo }` | On connect |
| `{ type: "screen", requestId, elements, screenHash }` | Response to get_screen |
| `{ type: "screenshot", requestId, image }` | Response to get_screenshot |
| `{ type: "result", requestId, success, error? }` | Response to execute |
| `{ type: "goal", text }` | User submits goal on phone |
| `{ type: "pong" }` | Response to ping |

### Server → Device

| Message | When |
|---------|------|
| `{ type: "auth_ok", deviceId }` | Auth succeeded |
| `{ type: "auth_error", message }` | Auth failed |
| `{ type: "get_screen", requestId }` | Agent loop needs screen tree |
| `{ type: "get_screenshot", requestId }` | Vision fallback |
| `{ type: "execute", requestId, action }` | Execute tap/type/swipe/etc |
| `{ type: "ping" }` | Heartbeat check |
| `{ type: "step", step, action, reasoning }` | Live step update (for phone UI) |
| `{ type: "goal_started", sessionId }` | Agent loop started |
| `{ type: "goal_completed", sessionId }` | Agent loop done |
| `{ type: "goal_failed", sessionId, error }` | Agent loop failed |

---

## Battery Optimization

OEM-specific battery killers are the #2 reliability problem after Google Play policy.

**Strategy:**
1. Detect if battery optimization is disabled: `PowerManager.isIgnoringBatteryOptimizations()`
2. If not, show warning card in Settings with button to request exemption
3. For aggressive OEMs (Xiaomi, Huawei, Samsung, OnePlus, Oppo, Vivo), show additional guidance linking to dontkillmyapp.com
4. ConnectionService uses `PARTIAL_WAKE_LOCK` to prevent CPU sleep during active goals
5. Foreground service notification keeps process priority high

---

## Distribution

- **Primary:** APK sideload from droidclaw.ai
- **Secondary:** F-Droid
- **NOT Play Store:** Google Play policy (Nov 2025) explicitly prohibits autonomous AI action execution via AccessibilityService

---

## Known Limitations

1. **FLAG_SECURE apps** (banking, password managers) block both tree and screenshots
2. **WebView/Flutter** apps may return empty accessibility trees — server falls back to vision
3. **Android 14+** requires per-session MediaProjection consent
4. **Android 16 Advanced Protection** will auto-revoke accessibility for non-accessibility tools
5. **dispatchGesture()** can be detected/ignored by some apps — node-first strategy mitigates
6. **rootInActiveWindow** returns null during transitions — retry with backoff
