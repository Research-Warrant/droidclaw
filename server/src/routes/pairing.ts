import { Hono } from "hono";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { db } from "../db.js";
import { pairingCode } from "../schema.js";
import { eq, and, gt } from "drizzle-orm";
import { auth } from "../auth.js";

// ── Rate limiter for claim endpoint ──
const claimAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = claimAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    claimAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  entry.count++;
  return entry.count > 5;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of claimAttempts) {
    if (now > entry.resetAt) claimAttempts.delete(ip);
  }
}, 5 * 60_000);

// ── Authenticated routes (create + status) ──
const authed = new Hono<AuthEnv>();
authed.use("*", sessionMiddleware);

/** POST /pairing/create — generate a 6-digit pairing code */
authed.post("/create", async (c) => {
  const user = c.get("user");

  // Delete any existing code for this user (one active code at a time)
  await db.delete(pairingCode).where(eq(pairingCode.userId, user.id));

  // Generate random 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 minutes
  const id = crypto.randomUUID();

  await db.insert(pairingCode).values({
    id,
    code,
    userId: user.id,
    expiresAt,
  });

  return c.json({ code, expiresAt: expiresAt.toISOString() });
});

/** GET /pairing/status — check if user's code was claimed */
authed.get("/status", async (c) => {
  const user = c.get("user");
  const now = new Date();

  const rows = await db
    .select()
    .from(pairingCode)
    .where(eq(pairingCode.userId, user.id))
    .limit(1);

  if (rows.length === 0) {
    // No code exists — it was claimed and deleted
    return c.json({ paired: true });
  }

  const row = rows[0];
  if (row.expiresAt < now) {
    return c.json({ paired: false, expired: true });
  }

  return c.json({ paired: false, expired: false });
});

// ── Public route (claim, no auth) ──
const pub = new Hono();

/** POST /pairing/claim — phone sends code to get API key + WS URL */
pub.post("/claim", async (c) => {
  // Rate limit by IP
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  if (isRateLimited(ip)) {
    return c.json({ error: "Too many attempts. Try again in a minute." }, 429);
  }

  const body = await c.req.json<{ code?: string }>();
  const code = body.code?.trim();

  // Validate 6-digit format
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  // Look up non-expired code
  const now = new Date();
  const rows = await db
    .select()
    .from(pairingCode)
    .where(and(eq(pairingCode.code, code), gt(pairingCode.expiresAt, now)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Invalid or expired code" }, 400);
  }

  const row = rows[0];

  // Generate API key for this user
  const result = await auth.api.createApiKey({
    body: {
      name: "Paired Device",
      prefix: "droidclaw_",
      userId: row.userId,
    },
  });

  // Delete the used code
  await db.delete(pairingCode).where(eq(pairingCode.id, row.id));

  const wsUrl = process.env.WS_URL ?? "wss://tunnel.droidclaw.ai";

  return c.json({ apiKey: result.key, wsUrl });
});

// ── Combined router ──
const pairing = new Hono();
pairing.route("/", authed);
pairing.route("/", pub);

export { pairing };
