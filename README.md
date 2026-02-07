# DroidClaw

Give it a goal in plain English. It figures out what to tap, type, and swipe on your Android phone to get it done.

It reads the screen (accessibility tree + optional screenshot), sends it to an LLM, gets back a JSON action like `{"action": "tap", "coordinates": [540, 1200]}`, executes it via ADB, and repeats. Perception → reasoning → action, in a loop.

## See it work

```
$ bun run src/kernel.ts
Enter your goal: Open YouTube and search for "lofi hip hop"

--- Step 1/30 ---
Think: I'm on the home screen. I should launch YouTube directly.
Decision: launch — Open YouTube app (842ms)

--- Step 2/30 ---
Think: YouTube is open. I need to tap the search icon.
Decision: tap — Tap search icon at top right (623ms)

--- Step 3/30 ---
Think: Search field is focused and ready.
Decision: type — Type "lofi hip hop" (501ms)

--- Step 4/30 ---
Decision: enter — Submit the search (389ms)

--- Step 5/30 ---
Think: Search results showing lofi hip hop videos. Done.
Decision: done (412ms)

Task completed successfully.
```

## Quick start

You need: **Bun**, **ADB**, and an **API key** for any LLM provider.

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install ADB (macOS)
brew install android-platform-tools

# Clone and setup
bun install
cp .env.example .env
```

Edit `.env` — fastest way to start is with Groq (free tier):

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

Get your key at [console.groq.com](https://console.groq.com).

### Connect your phone

Enable USB Debugging: Settings → About Phone → tap "Build Number" 7 times → Developer Options → USB Debugging.

```bash
adb devices   # should show your device
```

### Run it

```bash
bun run src/kernel.ts
```

Type a goal and watch your phone do it.

## Workflows

Workflows chain multiple goals across apps. Way more powerful than single goals.

```bash
bun run src/kernel.ts --workflow examples/weather-to-whatsapp.json
```

### 34 ready-to-use workflows included

**Messaging** — whatsapp-reply, whatsapp-broadcast, whatsapp-to-email, telegram-channel-digest, telegram-send-message, slack-standup, slack-check-messages, email-digest, email-reply, translate-and-reply

**Social Media** — social-media-post (Twitter + LinkedIn), social-media-engage, instagram-post-check

**Productivity** — morning-briefing, calendar-create-event, notes-capture, notification-cleanup, do-not-disturb, github-check-prs, screenshot-share-slack

**Research** — google-search-report, news-roundup, multi-app-research, price-comparison

**Lifestyle** — food-order, uber-ride, maps-commute, check-flight-status, spotify-playlist, youtube-watch-later, fitness-log, expense-tracker, wifi-password-share, weather-to-whatsapp

Each workflow is a simple JSON file:

```json
{
  "name": "Slack Daily Standup",
  "steps": [
    {
      "app": "com.Slack",
      "goal": "Open #standup channel, type the standup message and send it.",
      "formData": {
        "Message": "Yesterday: Finished API integration\nToday: Writing tests\nBlockers: None"
      }
    }
  ]
}
```

## What it can do

22 actions + 6 multi-step skills. Some example goals:

```
Open WhatsApp and send "I'm running late" to Mom
Turn on WiFi
Search Google for "best restaurants near me"
Open YouTube and play the first trending video
Copy tracking number from Amazon and search it on Google
```

## LLM providers

Pick one. They all work.

| Provider | Cost | Vision | Best for |
|---|---|---|---|
| **Groq** | Free tier | No | Getting started fast |
| **OpenRouter** | Pay per token | Yes | 200+ models (Claude, Gemini, etc.) |
| **OpenAI** | Pay per token | Yes | Best accuracy with GPT-4o |
| **AWS Bedrock** | Pay per token | Yes | Enterprise / Claude on AWS |

```bash
# Groq (recommended to start)
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile

# OpenRouter
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-your_key_here
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your_key_here
OPENAI_MODEL=gpt-4o

# AWS Bedrock (uses aws configure credentials)
LLM_PROVIDER=bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL=anthropic.claude-3-sonnet-20240229-v1:0
```

## Config

All in `.env`. Here's what matters:

| Setting | Default | What it does |
|---|---|---|
| `MAX_STEPS` | 30 | Steps before giving up |
| `STEP_DELAY` | 2 | Seconds between actions (UI settle time) |
| `STUCK_THRESHOLD` | 3 | Steps before stuck-loop recovery kicks in |
| `VISION_MODE` | fallback | `off` / `fallback` (screenshot when accessibility tree is empty) / `always` |
| `MAX_ELEMENTS` | 40 | UI elements sent to LLM (scored & ranked) |
| `MAX_HISTORY_STEPS` | 10 | Past steps kept in conversation context |
| `STREAMING_ENABLED` | true | Stream LLM responses token-by-token |
| `LOG_DIR` | logs | Session logs directory |

## How it works

Each step: dump accessibility tree → score & filter elements → optionally screenshot → send to LLM → execute action → log → repeat.

The LLM thinks before acting:

```json
{
  "think": "Search field is focused. I should type the query.",
  "plan": ["Launch YouTube", "Tap search", "Type query", "Submit"],
  "planProgress": "Step 3: typing query",
  "action": "type",
  "text": "lofi hip hop"
}
```

**Stuck detection** — if the screen doesn't change for 3 steps, the kernel tells the LLM to try a different approach.

**Vision fallback** — when the accessibility tree is empty (games, WebViews, Flutter), it falls back to sending a screenshot.

**Conversation memory** — the LLM sees its full history of observations and decisions, so it won't repeat itself.

## Architecture

```
src/
  kernel.ts          — Main agent loop
  actions.ts         — 22 actions + ADB retry logic
  skills.ts          — 6 multi-step skills (read_screen, submit_message, etc.)
  workflow.ts        — Workflow orchestration engine
  llm-providers.ts   — 4 LLM providers + system prompt
  sanitizer.ts       — Accessibility XML parser + smart filtering
  config.ts          — Env config
  constants.ts       — Keycodes, coordinates, defaults
  logger.ts          — Session logging
```

## Commands

```bash
bun install              # Install dependencies
bun run src/kernel.ts    # Start the agent
bun run build            # Compile to dist/
bun run typecheck        # Type-check (tsc --noEmit)
```

## Troubleshooting

**"adb: command not found"** — Install ADB or set `ADB_PATH=/full/path/to/adb` in `.env`.

**"no devices found"** — Run `adb devices`. Check USB debugging is enabled and you tapped "Allow" on the phone.

**Agent keeps repeating the same action** — Stuck loop detection handles this automatically. If it persists, try a more capable model (GPT-4o, Claude).

**High token usage** — Set `VISION_MODE=off`, lower `MAX_ELEMENTS` to 20, lower `MAX_HISTORY_STEPS` to 5, or use a cheaper model.

## Docs

- [Use Cases](docs/use-cases.md) — 50+ examples across 15 categories
- [ADB Commands](docs/adb-commands.md) — 750+ shell commands reference
- [Capabilities & Limitations](docs/capabilities-and-limitations.md)

## License

MIT
