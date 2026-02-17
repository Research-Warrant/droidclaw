import type { Context, Next } from "hono";
import { db } from "../db.js";
import { session as sessionTable, user as userTable } from "../schema.js";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";

/** Hono Env type for routes protected by sessionMiddleware */
export type AuthEnv = {
  Variables: {
    user: { id: string; name: string; email: string; [key: string]: unknown };
    session: { id: string; userId: string; [key: string]: unknown };
  };
};

export async function sessionMiddleware(c: Context, next: Next) {
  // Extract session token from cookie (same approach as dashboard WS auth)
  const rawCookie = getCookie(c, "better-auth.session_token");
  if (!rawCookie) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // Token may have a signature appended after a dot — use only the token part
  const token = rawCookie.split(".")[0];

  // Direct DB lookup (proven to work, unlike auth.api.getSession)
  const rows = await db
    .select({
      sessionId: sessionTable.id,
      userId: sessionTable.userId,
    })
    .from(sessionTable)
    .where(eq(sessionTable.token, token))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const { sessionId, userId } = rows[0];

  // Fetch user info
  const users = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", users[0]);
  c.set("session", { id: sessionId, userId });
  await next();
}
