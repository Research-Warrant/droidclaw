# OTP Device Pairing + Self-Host Toggle

**Date:** 2026-02-23
**Status:** Approved

## Problem

Current onboarding requires users to copy a long API key from the web dashboard and paste it into the Android app. This is high friction for consumer users. Additionally, the tunnel URL (`wss://tunnel.droidclaw.ai`) is hardcoded as default with no clean way to switch to a self-hosted server.

## Solution

Two features:

1. **OTP Pairing** -- Replace API key copy-paste with a 6-digit code. User sees code on web, types it on phone, done.
2. **Self-Host Toggle** -- Radio button on Android: "DroidClaw Cloud" (default) vs "Self-hosted" (enter your own WebSocket URL + API key).

## Design Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Auth model after pairing | API key under the hood | Stateless, no refresh/expiry complexity, industry standard for IoT pairing. Key auto-generated during OTP claim, sent to phone silently. |
| OTP display location | Devices page in dashboard | "Pair Device" button -- devices already live here. |
| Self-host toggle location | Android app only | Web dashboard doesn't need it -- it IS the server. |
| OTP expiry | 5 minutes, single-use | Standard for pairing codes. |
| OTP storage | `pairing_code` DB table | Survives server restarts, works across multiple instances. Row deleted after successful claim. |

## Flow: OTP Pairing

```
WEB (Devices page)               SERVER                      ANDROID APP
──────────────────               ──────                      ───────────

1. Click "Pair Device"
   Shows 6-digit code     POST /api/pairing/create
   + countdown timer  ──────────────►
                          Generates code
                          Stores in DB:
                          pairing_code {code, userId, expiresAt}
                                                              2. User types code
                                                                 on phone
                          POST /api/pairing/claim
                     ◄────────────────────────────────────────
                          {code, deviceInfo}

                          Validates code:
                          - Exists? Not expired?
                          - Auto-generates API key
                            via better-auth
                          - Deletes used code
                          - Returns {apiKey, wsUrl}
                     ────────────────────────────────────────►
                                                              3. Phone stores apiKey
                                                                 + wsUrl in DataStore
                                                                 Connects via WebSocket
                                                                 (same auth as today)

   Detects pairing via                                        4. Connected!
   polling/WebSocket
   Shows "Device Paired!"
```

## API Endpoints

### POST /api/pairing/create

**Auth:** Requires session (web dashboard login).

**Response:**
```json
{
  "code": "738412",
  "expiresAt": "2026-02-23T10:05:00Z"
}
```

Server stores in `pairing_code` table: `{id, code, userId, createdAt, expiresAt}`. Only one active code per user (creating a new one deletes the old one).

**DB schema:**
```sql
pairing_code (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  user_id   TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
)
```

### POST /api/pairing/claim

**Auth:** None (the code IS the auth).

**Request:**
```json
{
  "code": "738412",
  "deviceInfo": {
    "model": "Pixel 8",
    "manufacturer": "Google",
    "androidVersion": "15",
    "screenWidth": 1080,
    "screenHeight": 2400
  }
}
```

**Response:**
```json
{
  "apiKey": "droidclaw_xxxxxxxxxxxxxxxx",
  "wsUrl": "wss://tunnel.droidclaw.ai"
}
```

**Error responses:**
- `400` -- Invalid or expired code
- `429` -- Too many attempts (rate limit: 5 attempts per minute per IP)

### GET /api/pairing/status

**Auth:** Requires session.

**Response:**
```json
{
  "paired": true,
  "deviceName": "Pixel 8 (Android 15)"
}
```

Web dashboard polls this every 2s while showing the pairing code.

## UI: Web Dashboard (Devices Page)

### Before pairing (no devices):
```
┌──────────────────────────────────────────────────┐
│  Devices                                          │
│──────────────────────────────────────────────────│
│                                                   │
│           No devices connected yet                │
│                                                   │
│           [ + Pair Device ]                       │
│                                                   │
└──────────────────────────────────────────────────┘
```

### Pairing modal:
```
┌──────────────────────────────────────────────────┐
│  Pair Your Device                           [X]   │
│──────────────────────────────────────────────────│
│                                                   │
│  Open DroidClaw on your Android device and        │
│  enter this code:                                 │
│                                                   │
│          ┌───┬───┬───┬───┬───┬───┐               │
│          │ 7 │ 3 │ 8 │ 4 │ 1 │ 2 │               │
│          └───┴───┴───┴───┴───┴───┘               │
│                                                   │
│          Expires in 4:58                          │
│                                                   │
│          Waiting for device...  ◌                 │
│                                                   │
│──────────────────────────────────────────────────│
│  Developer? Use API keys for manual setup →       │
└──────────────────────────────────────────────────┘
```

### After pairing:
```
┌──────────────────────────────────────────────────┐
│  Pair Your Device                           [X]   │
│──────────────────────────────────────────────────│
│                                                   │
│          ✓ Device Paired!                         │
│                                                   │
│          Pixel 8 (Android 15)                     │
│          Connected                                │
│                                                   │
│          [ Done ]                                 │
│                                                   │
└──────────────────────────────────────────────────┘
```

## UI: Android Onboarding (Updated)

### Default (consumer):
```
┌──────────────────────────────────────────┐
│                                          │
│         DroidClaw                        │
│                                          │
│     Pair your device to get started      │
│                                          │
│  1. Open droidclaw.ai/dashboard          │
│  2. Go to Devices > Pair Device          │
│  3. Enter the 6-digit code below         │
│                                          │
│        ┌──┬──┬──┬──┬──┬──┐              │
│        │  │  │  │  │  │  │              │
│        └──┴──┴──┴──┴──┴──┘              │
│                                          │
│        [ Connect ]                       │
│                                          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─      │
│  Self-hosting? Tap here for manual setup │
│                                          │
└──────────────────────────────────────────┘
```

### "Self-hosting?" expands to:
```
┌──────────────────────────────────────────┐
│  Manual Setup                            │
│                                          │
│  Server URL                              │
│  ┌──────────────────────────────────┐    │
│  │ wss://                            │    │
│  └──────────────────────────────────┘    │
│                                          │
│  API Key                                 │
│  ┌──────────────────────────────────┐    │
│  │                                   │    │
│  └──────────────────────────────────┘    │
│                                          │
│  [ Connect ]                             │
│                                          │
└──────────────────────────────────────────┘
```

## UI: Android Settings (Updated)

```
┌──────────────────────────────────────────┐
│  < Settings                              │
│──────────────────────────────────────────│
│                                          │
│  Connection                              │
│  ┌──────────────────────────────────┐    │
│  │  (o) DroidClaw Cloud             │    │
│  │  ( ) Self-hosted                  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  (When "Self-hosted" selected:)          │
│  ┌──────────────────────────────────┐    │
│  │ WebSocket URL                     │    │
│  │ wss://my-server.example.com       │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ API Key                           │    │
│  │ ••••••••••••••••••••              │    │
│  └──────────────────────────────────┘    │
│                                          │
│  [ Test Connection ]                     │
│                                          │
│──────────────────────────────────────────│
│  Device                                  │
│  Device name: Pixel 8                    │
│──────────────────────────────────────────│
└──────────────────────────────────────────┘
```

## Security

- **Rate limiting on /api/pairing/claim**: 5 attempts per minute per IP. Prevents brute-forcing 6-digit codes (1M combinations, 5/min = 200K minutes to exhaust).
- **Single-use codes**: Deleted immediately after successful claim.
- **One code per user**: Creating a new code invalidates the previous one.
- **5-minute expiry**: Limits attack window.
- **API key in response**: Sent over HTTPS, stored encrypted in Android DataStore.

## What Changes Where

| Component | Files | Change |
|-----------|-------|--------|
| Server | `server/src/schema.ts` | Add `pairingCode` table |
| Server | New migration | `pairing_code` table |
| Server | `server/src/routes/pairing.ts` (new) | Create/claim/status endpoints |
| Server | `server/src/index.ts` | Register pairing routes |
| Web | `web/src/routes/dashboard/devices/+page.svelte` | "Pair Device" button, pairing modal, polling |
| Web | `web/src/lib/api/pairing.remote.ts` (new) | API client for pairing endpoints |
| Android | `OnboardingScreen.kt` | OTP input as default, "Self-hosting?" link |
| Android | `SettingsScreen.kt` | Radio toggle: Cloud vs Self-hosted |
| Android | `SettingsStore.kt` | Add `connectionMode` preference |
| Android | New API client | `POST /api/pairing/claim` call |

## Not Changing

- Existing API key auth on WebSocket (phone still sends API key)
- LLM config flow (unrelated)
- Voice transcription flow (unrelated)
- Existing API Keys page (still works for developers)
