# Workflow Automation v2

## Context

msomu's PR #6 added a workflow automation system (notification-triggered agent goals). The concept is valuable but the implementation had issues, so the workflow code was removed while keeping the overlay, stop_goal, and AbortSignal changes.

This doc captures what was good, what was wrong, and how to ship it properly.

## The Core Idea

Turn DroidClaw from a manual remote-control into a persistent automation engine. Users describe rules in plain English like:

- "When I get a WhatsApp message saying 'where are you', reply with 'Bangalore'"
- "Whenever someone messages me on Telegram, auto-reply with 'I'm busy'"
- "When boss emails me, open it and mark as important"

Notifications trigger the agent to execute goals automatically.

## What Was Built (and removed)

- **Input classifier** — LLM call on every goal to detect "goal" vs "workflow"
- **Workflow parser** — LLM converts natural language to structured trigger conditions (app, title, text matching with contains/exact/regex)
- **Workflow table** — Postgres storage for parsed workflows
- **NotificationListenerService** — Android service capturing all notifications, matching against synced workflows
- **Workflow CRUD** — create/update/delete/sync/trigger via WebSocket
- **Auto-execution** — matched workflows send goals to the agent pipeline with no confirmation

## Problems With v1

### 1. Classifier tax on every goal
Every goal got an extra LLM round-trip to decide if it's a goal or workflow. Adds latency and cost on 100% of requests to benefit ~5% of inputs.

### 2. LLM-generated regex is fragile
The parser asks the LLM to produce regex match conditions. LLMs are bad at regex. One wrong pattern = workflow never triggers or triggers on everything.

### 3. No guardrails on auto-execution
A notification match runs the full agent pipeline automatically — tapping, typing, navigating with zero human confirmation. One bad match = replying to your boss with the wrong message.

### 4. No observability
No execution history, no "workflow X triggered 5 times today", no way to preview what a workflow would match before enabling it.

### 5. Powerful permission for a v1
`NotificationListenerService` reads ALL notifications. Users will hesitate to grant that without clear value.

## v2 Design

### Explicit creation, not auto-classification
- A dedicated "Create Workflow" button/screen, not auto-detection of every goal input
- Remove the classifier entirely — goals are goals, workflows are created intentionally
- Web dashboard should also support workflow creation/management

### Confirmation mode (default)
- When a workflow matches a notification, show a confirmation notification: "Workflow 'Auto-reply busy' matched! Run this goal?"
- User taps to confirm, agent executes
- Power users can toggle to "auto-execute" per workflow after they trust it
- Three modes: `confirm` (default), `auto`, `disabled`

### Simple server-side conditions
- Don't use LLM to generate regex — use simple string matching configured via UI
- Fields: app name (dropdown from installed apps), title contains, text contains
- AND logic between conditions
- Let the LLM help draft the goal template, but conditions should be human-configured

### Execution log
- Record every trigger: timestamp, workflow name, matched notification, goal sent, result (success/fail/skipped)
- Show in web dashboard and in-app
- Rate limiting: max N triggers per workflow per hour (prevent notification storms)

### Scoped notification access
- Only listen for notifications from apps the user explicitly selects in workflow conditions
- Show exactly which apps are being monitored in settings
- Easy one-tap disable-all

### Goal template improvements
- Preview: show what the expanded goal would look like with sample notification data
- Variables: `{{app}}`, `{{title}}`, `{{text}}`, `{{time}}`
- Test button: "Simulate this workflow with a fake notification"

## Implementation Order

1. **Web dashboard workflow CRUD** — create/edit/delete workflows with simple condition builder
2. **Confirmation mode** — notification-based confirm-before-execute
3. **Execution log** — record and display trigger history
4. **Scoped notification listener** — only monitor selected apps
5. **Auto-execute toggle** — per-workflow setting for trusted workflows
6. **Rate limiting** — prevent runaway triggers

## Schema (revised)

```sql
CREATE TABLE workflow (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'confirm', -- confirm | auto | disabled
  conditions JSONB NOT NULL DEFAULT '[]',
  goal_template TEXT NOT NULL,
  max_triggers_per_hour INT DEFAULT 5,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE workflow_execution (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  notification_app TEXT,
  notification_title TEXT,
  notification_text TEXT,
  expanded_goal TEXT NOT NULL,
  status TEXT NOT NULL, -- confirmed | auto_executed | skipped | failed
  agent_session_id TEXT REFERENCES agent_session(id),
  triggered_at TIMESTAMP DEFAULT NOW()
);
```

## Key Principle

The agent taking autonomous action on a user's phone is powerful and dangerous. Default to safety: confirm before executing, log everything, let users build trust gradually before enabling auto-mode.
