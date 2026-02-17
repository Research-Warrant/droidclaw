import { Hono } from "hono";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";

const devices = new Hono<AuthEnv>();
devices.use("*", sessionMiddleware);

devices.get("/", (c) => {
  const user = c.get("user");
  const userDevices = sessions.getDevicesForUser(user.id);

  return c.json(
    userDevices.map((d) => ({
      deviceId: d.deviceId,
      name: d.deviceInfo?.model ?? "Unknown Device",
      deviceInfo: d.deviceInfo,
      connectedAt: d.connectedAt.toISOString(),
    }))
  );
});

export { devices };
