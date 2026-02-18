import type { Context, Next } from "hono";
import { auth } from "../auth.js";

/** Hono Env type for routes protected by sessionMiddleware */
export type AuthEnv = {
  Variables: {
    user: { id: string; name: string; email: string; [key: string]: unknown };
    session: { id: string; userId: string; [key: string]: unknown };
  };
};

export async function sessionMiddleware(c: Context, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);
  await next();
}
