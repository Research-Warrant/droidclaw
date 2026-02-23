# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DroidClaw — an AI agent that controls Android devices through the Accessibility API. The cloud architecture: Web Dashboard (SvelteKit) → Server (Hono/Bun) → Android App (Jetpack Compose) via WebSocket. The server runs the Perception → Reasoning → Action loop, sending commands to the Android companion app which executes them via AccessibilityService.

There is also a standalone CLI agent in `src/` that connects directly to a device via ADB.

## Monorepo Structure

```
server/          — Hono API + WebSocket server (Bun, TypeScript)
web/             — SvelteKit dashboard (Svelte 5, Tailwind)
android/         — Companion app (Kotlin, Jetpack Compose)
src/             — Standalone CLI agent (Bun, TypeScript)
scripts/         — Release and utility scripts
docs/plans/      — Design docs and implementation plans
```

## Commands

```bash
# Server
bun install --cwd server
bun run --cwd server src/index.ts          # Start server (port 8080)

# Web
bun install --cwd web
bun run --cwd web dev                      # Dev server (port 5173)

# Android
cd android && ./gradlew assembleDebug      # Build debug APK

# CLI agent (standalone, connects via ADB)
bun install
bun run src/kernel.ts

# Release
./scripts/release.sh v0.5.0               # Build APK, generate notes, create GitHub release
```

There are no tests currently.

## Server (`server/`)

Hono HTTP + WebSocket server running on Bun.

- **`src/index.ts`** — Entry point, Bun.serve with WebSocket upgrade
- **`src/routes/`** — HTTP routes: `auth.ts`, `pairing.ts`, `devices.ts`, `settings.ts`, `api-keys.ts`, `health.ts`, `license.ts`
- **`src/ws/`** — WebSocket handlers: `device.ts` (phone connections), `dashboard.ts` (web dashboard live updates), `voice.ts` (Groq Whisper STT)
- **`src/agent/`** — Agent loop: `loop.ts` (perception→reasoning→action), `llm.ts` (system prompt + LLM provider calls)
- **`src/middleware/auth.ts`** — Session + API key auth via better-auth
- **`src/db.ts`** + **`src/schema.ts`** — Drizzle ORM with PostgreSQL

Key patterns:
- **Per-route middleware:** Don't use wildcard `use("*", sessionMiddleware)` on sub-routers — it intercepts ALL routes including ones mounted later. Use inline middleware per route instead.
- **Pairing flow:** `/pairing/claim` is PUBLIC (no auth), `/pairing/create` and `/pairing/status` require session auth.

### Server Environment

Copy `server/.env.example` to `server/.env`:
```
DATABASE_URL="postgres://..."
PORT=8080
CORS_ORIGIN="http://localhost:5173"
GROQ_VOICE_API_KEY="gsk_..."    # Server-managed, for voice transcription
```

User LLM keys (OpenAI, Groq, OpenRouter, etc.) are stored per-user in the database via the web settings page, NOT in `.env`.

## Web Dashboard (`web/`)

SvelteKit app with Svelte 5 runes (`$state`, `$effect`), Tailwind CSS, and server functions (`query`/`form` from `$app/server`).

- **`src/routes/dashboard/`** — Main pages: devices, settings, api-keys
- **`src/lib/api/`** — Server-side remote functions (e.g., `settings.remote.ts`, `pairing.remote.ts`)
- **`src/lib/components/`** — Shared components (DeviceCard, UI primitives)
- **`src/lib/stores/`** — Svelte stores (dashboard WebSocket)

Key patterns:
- **LLM model dropdown:** `PROVIDER_MODELS` map in settings page provides curated models per provider (OpenAI, Groq, OpenRouter) with "Custom model ID..." fallback.
- **OTP pairing:** Devices page has a Pair Device modal that generates a 6-digit code, polls `/pairing/status` until claimed.

## Android App (`android/`)

Kotlin + Jetpack Compose companion app.

- **`ui/screens/`** — `OnboardingScreen.kt` (OTP pairing + permissions), `HomeScreen.kt`, `SettingsScreen.kt`
- **`connection/`** — `ConnectionService.kt` (foreground service), `ReliableWebSocket.kt`, `CommandRouter.kt`, `PairingApi.kt`
- **`accessibility/`** — `DroidClawAccessibilityService.kt`, `GestureExecutor.kt` (24 action handlers), `ScreenTreeBuilder.kt`
- **`capture/`** — `ScreenCaptureManager.kt` (MediaProjection screenshots)
- **`overlay/`** — `CommandPanelOverlay.kt`, `AgentOverlay.kt` (floating pill widget + voice)
- **`data/SettingsStore.kt`** — DataStore preferences (apiKey, serverUrl, connectionMode, etc.)

Key patterns:
- **Connection modes:** "cloud" (default, OTP pairing) or "selfhosted" (manual API key + server URL)
- **Action execution:** `GestureExecutor.execute()` handles all 24 actions via AccessibilityService APIs, not ADB
- **Screenshot:** Uses `GLOBAL_ACTION_TAKE_SCREENSHOT` (API 28+)

## CLI Agent (`src/`)

Standalone agent that connects directly to a device via ADB (no server needed).

- **`kernel.ts`** — Main agent loop
- **`actions.ts`** — ADB-based action execution
- **`llm-providers.ts`** — LLM provider abstraction (OpenAI, Groq, Ollama, Bedrock, OpenRouter)
- **`skills.ts`** — Multi-step actions (read_screen, compose_email, etc.)
- **`workflow.ts`** — Multi-app workflow orchestration

## Adding a New Action (Cloud)

1. Add action JSON to `SYSTEM_PROMPT` in `server/src/agent/llm.ts`
2. Add message-to-command mapping in `server/src/agent/loop.ts` (or rely on default pass-through)
3. Add action type to `CommandRouter.kt` routing list
4. Implement handler in `GestureExecutor.kt`

## Releasing

```bash
./scripts/release.sh v0.5.0
```

This builds the debug APK, generates release notes from commits since last tag, updates the APK download link in the web dashboard, and creates a GitHub release.

## Git Conventions

- Do NOT add `Co-Authored-By: Claude` lines to commit messages.
- Commit prefixes: `feat`, `fix`, `refactor`, `style`, `chore`, `docs` with optional scope like `feat(android):`, `fix(server):`
