import { Hono } from "hono";
import { sessions } from "../ws/sessions.js";

const health = new Hono();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    connectedDevices: sessions.getStats().devices,
  });
});

export { health };
