# How It All Connects — Web UI to Phone Execution

Complete breakdown of what happens when you type "Send Mom I'll be late tonight" on a web page and it executes on an Android phone.

---

## The 3 Pieces

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PHONE 1       │     │   SERVER         │     │   PHONE 2       │
│   (your daily)  │     │   (Raspberry Pi, │     │   (agent phone)  │
│                 │     │    VPS, laptop)  │     │                 │
│   Browser with  │     │   SvelteKit app  │     │   Android phone │
│   SvelteKit UI  │────>│   + Kernel       │────>│   with USB      │
│                 │     │                  │     │   debugging ON  │
│   "Send Mom     │     │   Runs the AI    │     │                 │
│    I'll be late │     │   loop + ADB     │     │   WhatsApp,     │
│    tonight"     │     │   commands       │     │   Settings, etc │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     YOU                    THE BRAIN               THE HANDS
```

---

## Without Tailscale (Same WiFi Network)

When all 3 devices are on the same home/office WiFi:

```
┌──────────────────────── Home WiFi (192.168.1.x) ────────────────────────┐
│                                                                          │
│   Phone 1                    Server                     Phone 2          │
│   192.168.1.10               192.168.1.100              192.168.1.42     │
│                                                                          │
│   Browser ──HTTP──> SvelteKit (:3000)                                   │
│                        │                                                 │
│                        │ kernel.run("Send Mom...")                       │
│                        │                                                 │
│                        ├──ADB WiFi──> adb connect 192.168.1.42:5555     │
│                        │              adb shell uiautomator dump        │
│                        │              adb shell input tap 540 1200      │
│                        │              adb shell input text "I'll be..." │
│                        │                                                 │
│                        ├──HTTPS──> Groq/OpenAI API (LLM decision)       │
│                        │                                                 │
│                        │ result: { success: true, steps: 7 }            │
│                        │                                                 │
│   Browser <──HTTP──    │                                                 │
│   "Done! Sent in                                                        │
│    7 steps"                                                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Problem:** Only works when you're home. Leave the house = can't reach the server.

---

## With Tailscale (From Anywhere)

Tailscale creates a private encrypted network across all your devices, no matter where they are. Each device gets a stable IP (100.x.x.x) that works from anywhere.

```
┌─── Phone 1 (coffee shop wifi) ───┐
│   Tailscale IP: 100.64.0.1       │
│   Browser                         │
│      │                            │
└──────│────────────────────────────┘
       │
       │  HTTPS (encrypted, via Tailscale tunnel)
       │  https://100.64.0.2:3000
       │
  ─────│──────── Internet ────────────────
       │
       │
┌──────│──────────────────────────────────────────┐
│      │                                           │
│   ┌──▼──────────────────┐    ┌────────────────┐ │
│   │ Server               │    │ Phone 2        │ │
│   │ Tailscale: 100.64.0.2│   │ 192.168.1.42   │ │  ← Same local
│   │                      │    │                │ │     network
│   │ SvelteKit + Kernel   │────│ ADB WiFi :5555 │ │
│   │                      │    │                │ │
│   └──────────────────────┘    └────────────────┘ │
│                                                   │
│              Home Network                         │
└───────────────────────────────────────────────────┘
```

**What Tailscale does:**
- Phone 1 (anywhere) can reach Server at `100.64.0.2` as if they're on the same network
- Encrypted WireGuard tunnel, no port forwarding, no public IP needed
- Server + Phone 2 stay at home, always connected via local WiFi
- Phone 2 does NOT need Tailscale — only Phone 1 and Server need it

---

## The Full Sequence — Step by Step

Here's exactly what happens when you type "Send Mom I'll be late tonight" and hit enter:

```
TIME    PHONE 1 (browser)          SERVER (SvelteKit + Kernel)         PHONE 2 (agent)
─────   ─────────────────          ──────────────────────────          ────────────────

0.0s    User types goal
        "Send Mom I'll be
        late tonight"
        Hits ENTER
           │
           │  POST /api/run
           │  { goal: "Send Mom..." }
           │
0.1s       │──────────────────────>│
           │                       │  kernel.run(goal) starts
           │                       │
           │                       │  ┌─── STEP 1 ───────────────────────────────────┐
           │                       │  │                                               │
0.2s       │                       │──│── adb shell uiautomator dump ──────────────>│
           │                       │  │                                     dumps UI │
0.5s       │                       │<─│── XML file pulled back ────────────────────│
           │                       │  │                                               │
           │                       │  │  sanitizer.ts parses XML                     │
           │                       │  │  → 47 elements found                          │
           │                       │  │  → filtered to top 40                         │
           │                       │  │  → foreground: launcher                       │
           │                       │  │                                               │
0.6s       │                       │  │  Builds message for LLM:                     │
           │                       │  │  [system prompt + goal + screen state]        │
           │                       │  │                                               │
           │                       │──│── POST https://api.groq.com/chat ──> Internet
           │                       │  │   "Here's the screen, goal is..."             │
           │                       │  │                                               │
1.4s       │                       │<─│── LLM responds:                               │
           │                       │  │   {                                           │
           │  SSE: step 1          │  │     "think": "I'm on home screen,            │
           │  "Launching WhatsApp" │  │              need to open WhatsApp",          │
1.5s       │<─────────────────────│  │     "action": "launch",                      │
           │  (shows on UI)        │  │     "package": "com.whatsapp"                │
           │                       │  │   }                                           │
           │                       │  │                                               │
           │                       │──│── adb shell monkey -p com.whatsapp ────────>│
           │                       │  │                                    opens app │
1.8s       │                       │  │  sleep(2s) — wait for UI to settle           │
           │                       │  └───────────────────────────────────────────────┘
           │                       │
           │                       │  ┌─── STEP 2 ───────────────────────────────────┐
3.8s       │                       │──│── adb shell uiautomator dump ──────────────>│
           │                       │<─│── XML (WhatsApp home screen) ───────────────│
           │                       │  │                                               │
           │                       │  │  Elements: search icon, chats list, tabs...  │
           │                       │  │                                               │
           │                       │──│── POST to LLM ──────────────────> Internet   │
           │                       │<─│── { "action": "tap",                         │
           │  SSE: step 2          │  │     "coordinates": [978, 142],               │
           │  "Tapping search"     │  │     "think": "Tap search to find Mom" }      │
4.8s       │<─────────────────────│  │                                               │
           │                       │──│── adb shell input tap 978 142 ─────────────>│
           │                       │  │                                    taps icon │
           │                       │  └───────────────────────────────────────────────┘
           │                       │
           │                       │  ┌─── STEP 3 ───────────────────────────────────┐
           │                       │  │  (same pattern: dump → LLM → execute)        │
           │  SSE: step 3          │  │                                               │
           │  "Typing 'Mom'"       │──│── adb shell input text "Mom" ──────────────>│
           │                       │  └───────────────────────────────────────────────┘
           │                       │
           │                       │  ┌─── STEP 4 ───────────────────────────────────┐
           │  SSE: step 4          │  │                                               │
           │  "Tapping Mom's chat" │──│── adb shell input tap 540 380 ─────────────>│
           │                       │  └───────────────────────────────────────────────┘
           │                       │
           │                       │  ┌─── STEP 5 ───────────────────────────────────┐
           │  SSE: step 5          │  │                                               │
           │  "Typing message"     │──│── adb shell input text                      │
           │                       │  │   "I'll%sbe%slate%stonight" ───────────────>│
           │                       │  └───────────────────────────────────────────────┘
           │                       │
           │                       │  ┌─── STEP 6 ───────────────────────────────────┐
           │  SSE: step 6          │  │                                               │
           │  "Tapping send"       │──│── adb shell input tap 1005 2280 ───────────>│
           │                       │  └───────────────────────────────────────────────┘
           │                       │
           │                       │  ┌─── STEP 7 ───────────────────────────────────┐
           │  SSE: step 7          │  │  LLM: { "action": "done",                   │
           │  "Done! ✓"            │  │         "reason": "Message sent to Mom" }    │
12.4s      │<─────────────────────│  └───────────────────────────────────────────────┘
           │                       │
           │  Shows result:        │  Session log saved:
           │  "Completed in        │  logs/1706234567890.json
           │   7 steps (12.4s)"    │
```

---

## The Communication Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  LAYER 4: User Interface                                           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ SvelteKit frontend (runs in Phone 1's browser)                │ │
│  │ - Text input for goal                                         │ │
│  │ - Real-time step updates via SSE (Server-Sent Events)        │ │
│  │ - Shows think/plan/progress from LLM                         │ │
│  │ - Displays screenshots if vision mode is on                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│           │ HTTP POST /api/run              ▲ SSE /api/run/stream  │
│           ▼                                 │                      │
│  LAYER 3: Web Server                                               │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ SvelteKit backend (server-side, runs on the Server)           │ │
│  │ - API route: POST /api/run { goal }                           │ │
│  │ - Starts kernel.run() as async task                           │ │
│  │ - Streams step updates back to browser via SSE                │ │
│  │ - Stores session history in DB/files                          │ │
│  └───────────────────────────────────────────────────────────────┘ │
│           │ function call                                          │
│           ▼                                                        │
│  LAYER 2: Kernel (the brain)                                       │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ kernel.ts — the agent loop                                    │ │
│  │                                                               │ │
│  │ for each step:                                                │ │
│  │   1. Call ADB to dump screen  ──────> (Layer 1)               │ │
│  │   2. Parse + filter elements                                  │ │
│  │   3. Send to LLM ──────────────────> Groq/OpenAI/etc (cloud) │ │
│  │   4. Parse LLM response                                      │ │
│  │   5. Execute action via ADB ──────> (Layer 1)                 │ │
│  │   6. Emit step event ─────────────> (Layer 3, for SSE)        │ │
│  │   7. Log to file                                              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│           │ Bun.spawnSync()                                        │
│           ▼                                                        │
│  LAYER 1: ADB (the hands)                                          │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ADB over WiFi (TCP connection to Phone 2)                     │ │
│  │                                                               │ │
│  │ Server ──TCP:5555──> Phone 2                                  │ │
│  │                                                               │ │
│  │ Commands:                                                     │ │
│  │   adb shell uiautomator dump    (read screen)                │ │
│  │   adb shell input tap x y       (tap)                        │ │
│  │   adb shell input text "..."    (type)                       │ │
│  │   adb shell input swipe ...     (scroll)                     │ │
│  │   adb shell am start ...        (launch app)                 │ │
│  │   adb shell screencap           (screenshot)                 │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Where Tailscale Fits

Tailscale is NOT part of the execution flow. It's a **network layer** that makes Phone 1 able to reach the Server when they're on different networks.

```
WITHOUT TAILSCALE:

  Phone 1 ──192.168.1.x──> Server ──192.168.1.x──> Phone 2

  ✓ Works on same WiFi
  ✗ Doesn't work from outside


WITH TAILSCALE:

  Phone 1 ──100.64.0.1──┐
                         │ Tailscale tunnel
                         │ (encrypted WireGuard)
                         │
  Server ──100.64.0.2 ──┘──192.168.1.x──> Phone 2

  ✓ Works from ANYWHERE
  ✓ No port forwarding
  ✓ No public IP needed
  ✓ Encrypted


WHAT GETS INSTALLED WHERE:

  Phone 1:  Tailscale app (from Play Store)
  Server:   Tailscale daemon (curl install)
  Phone 2:  NOTHING. Just USB debugging ON.
```

Tailscale is invisible to the kernel. The kernel doesn't know or care about Tailscale. It just talks to ADB like normal. Tailscale just makes the network path between Phone 1's browser and the Server work across the internet.

---

## The SvelteKit App Structure

```
web/
├── src/
│   ├── routes/
│   │   ├── +page.svelte              ← The UI (goal input, step viewer)
│   │   ├── api/
│   │   │   ├── run/
│   │   │   │   └── +server.ts        ← POST /api/run — starts kernel
│   │   │   ├── stream/
│   │   │   │   └── +server.ts        ← GET /api/stream — SSE step updates
│   │   │   └── status/
│   │   │       └── +server.ts        ← GET /api/status — device connected?
│   ├── lib/
│   │   ├── kernel-bridge.ts           ← Imports kernel, wraps as async API
│   │   └── stores.ts                  ← Svelte stores for UI state
├── package.json
└── svelte.config.js

kernel (existing):
├── src/
│   ├── kernel.ts                      ← Modified: export run() function
│   ├── actions.ts                     ← No changes
│   ├── llm-providers.ts               ← No changes
│   ├── sanitizer.ts                   ← No changes
│   ├── config.ts                      ← No changes
│   ├── constants.ts                   ← No changes
│   └── logger.ts                      ← No changes
```

---

## Data Flow Summary

```
YOU type "Send Mom I'll be late tonight"
    │
    ▼
Phone 1 browser ──HTTP POST──> Server (SvelteKit API route)
    │                               │
    │                               ▼
    │                          kernel.run(goal)
    │                               │
    │                               │ ┌──────── LOOP (7 times) ────────┐
    │                               │ │                                 │
    │                               │ │  1. adb shell uiautomator dump │──> Phone 2
    │                               │ │     (what's on screen?)        │<── XML
    │                               │ │                                 │
    │                               │ │  2. Parse XML → 40 elements    │
    │                               │ │                                 │
    │  SSE: live step updates       │ │  3. Send to LLM ──────────────>│──> Groq API
    │<──────────────────────────────│ │     (what should I do?)        │<── JSON
    │  "Step 3: Typing Mom"         │ │                                 │
    │                               │ │  4. Execute action             │
    │                               │ │     adb shell input tap x y   │──> Phone 2
    │                               │ │                                 │
    │                               │ │  5. Wait 2s for UI to settle  │
    │                               │ │                                 │
    │                               │ └─────────────────────────────────┘
    │                               │
    │  HTTP response: done          │
    │<──────────────────────────────│
    │                               │
    ▼                               ▼
"Done! 7 steps, 12.4s"        logs/session.json saved
```

---

## One-Line Summary

```
Browser (Phone 1) ──HTTP──> SvelteKit (Server) ──ADB WiFi──> Android (Phone 2)
                                  │
                                  ├──HTTPS──> LLM API (cloud) for decisions
                                  │
                            Tailscale makes this reachable from anywhere
```
