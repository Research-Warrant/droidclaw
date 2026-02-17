import { Hono } from "hono";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";

const goals = new Hono<AuthEnv>();
goals.use("*", sessionMiddleware);

goals.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ deviceId: string; goal: string }>();

  if (!body.deviceId || !body.goal) {
    return c.json({ error: "deviceId and goal are required" }, 400);
  }

  const device = sessions.getDevice(body.deviceId);
  if (!device) {
    return c.json({ error: "device not connected" }, 404);
  }

  if (device.userId !== user.id) {
    return c.json({ error: "device does not belong to you" }, 403);
  }

  // TODO (Task 6): start agent loop for this device+goal
  const sessionId = crypto.randomUUID();

  return c.json({
    sessionId,
    deviceId: body.deviceId,
    goal: body.goal,
    status: "queued",
  });
});

export { goals };
