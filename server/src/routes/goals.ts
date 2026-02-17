import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { runAgentLoop, type AgentLoopOptions } from "../agent/loop.js";
import type { LLMConfig } from "../agent/llm.js";
import { db } from "../db.js";
import { llmConfig as llmConfigTable } from "../schema.js";

const goals = new Hono<AuthEnv>();
goals.use("*", sessionMiddleware);

/** Track running agent sessions so we can prevent duplicates and cancel them */
const activeSessions = new Map<string, { sessionId: string; goal: string; abort: AbortController }>();

goals.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    goal: string;
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
    maxSteps?: number;
  }>();

  if (!body.deviceId || !body.goal) {
    return c.json({ error: "deviceId and goal are required" }, 400);
  }

  // Look up by connection ID first, then by persistent DB ID
  const device = sessions.getDevice(body.deviceId)
    ?? sessions.getDeviceByPersistentId(body.deviceId);
  if (!device) {
    return c.json({ error: "device not connected" }, 404);
  }

  if (device.userId !== user.id) {
    return c.json({ error: "device does not belong to you" }, 403);
  }

  // Prevent multiple agent loops on the same device
  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) {
    const existing = activeSessions.get(trackingKey)!;
    return c.json(
      { error: "agent already running on this device", sessionId: existing.sessionId, goal: existing.goal },
      409
    );
  }

  // Build LLM config: request body → user's DB config → env defaults
  let llmCfg: LLMConfig;

  if (body.llmApiKey) {
    llmCfg = {
      provider: body.llmProvider ?? process.env.LLM_PROVIDER ?? "openai",
      apiKey: body.llmApiKey,
      model: body.llmModel,
    };
  } else {
    // Fetch user's saved LLM config from DB (same as device WS handler)
    const configs = await db
      .select()
      .from(llmConfigTable)
      .where(eq(llmConfigTable.userId, user.id))
      .limit(1);

    if (configs.length > 0) {
      const cfg = configs[0];
      llmCfg = {
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        model: body.llmModel ?? cfg.model ?? undefined,
      };
    } else if (process.env.LLM_API_KEY) {
      llmCfg = {
        provider: process.env.LLM_PROVIDER ?? "openai",
        apiKey: process.env.LLM_API_KEY,
        model: body.llmModel,
      };
    } else {
      return c.json({ error: "No LLM provider configured. Set it up in the web dashboard Settings." }, 400);
    }
  }

  const options: AgentLoopOptions = {
    deviceId: device.deviceId,
    persistentDeviceId: device.persistentDeviceId,
    userId: user.id,
    goal: body.goal,
    llmConfig: llmCfg,
    maxSteps: body.maxSteps,
  };

  // Create abort controller for this session
  const abort = new AbortController();
  options.signal = abort.signal;

  // Start the agent loop in the background (fire-and-forget).
  // The client observes progress via the /ws/dashboard WebSocket.
  const loopPromise = runAgentLoop(options);

  // Track as active until it completes
  const sessionPlaceholder = { sessionId: "pending", goal: body.goal, abort };
  activeSessions.set(trackingKey, sessionPlaceholder);

  loopPromise
    .then((result) => {
      activeSessions.delete(trackingKey);
      console.log(
        `[Agent] Completed on ${device.deviceId}: ${result.success ? "success" : "incomplete"} in ${result.stepsUsed} steps (session ${result.sessionId})`
      );
    })
    .catch((err) => {
      activeSessions.delete(trackingKey);
      console.error(`[Agent] Error on ${device.deviceId}: ${err}`);
    });

  // We need the sessionId from the loop, but it's created inside runAgentLoop.
  // For immediate response, generate one here and let the dashboard events carry the real one.
  // The loop will emit goal_started with its sessionId momentarily.
  return c.json({
    deviceId: body.deviceId,
    goal: body.goal,
    status: "started",
  });
});

goals.post("/stop", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ deviceId: string }>();

  if (!body.deviceId) {
    return c.json({ error: "deviceId is required" }, 400);
  }

  // Look up device to verify ownership
  const device = sessions.getDevice(body.deviceId)
    ?? sessions.getDeviceByPersistentId(body.deviceId);
  if (!device) {
    return c.json({ error: "device not connected" }, 404);
  }
  if (device.userId !== user.id) {
    return c.json({ error: "device does not belong to you" }, 403);
  }

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  const active = activeSessions.get(trackingKey);
  if (!active) {
    return c.json({ error: "no agent running on this device" }, 404);
  }

  active.abort.abort();
  console.log(`[Agent] Stop requested for device ${body.deviceId}`);
  return c.json({ status: "stopping" });
});

export { goals };
