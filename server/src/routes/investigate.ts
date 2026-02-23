import { Hono } from "hono";
import { eq, and, desc, asc } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { db } from "../db.js";
import {
  agentSession,
  agentStep,
  appHint,
  llmConfig as llmConfigTable,
} from "../schema.js";
import { getLlmProvider, type LLMConfig } from "../agent/llm.js";

const investigate = new Hono<AuthEnv>();
investigate.use("*", sessionMiddleware);

const ANALYSIS_SYSTEM_PROMPT = `You are an Android automation post-mortem analyst. Analyze the session transcript and identify recurring failure patterns, wasted steps, and wrong paths.

Generate 3-5 SHORT, ACTIONABLE hints (max 30 words each) for future sessions with this app. Each hint must:
1. Describe a specific behavior of this app's UI
2. Tell the agent exactly what to do (or avoid) in that situation
3. Be imperative voice ("Tap X", "After Y, do Z", "Do NOT use...")

Return JSON: {"hints": ["hint1", "hint2", ...], "analysis": "2-3 sentence summary"}`;

investigate.post("/:sessionId", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");

  // 1. Verify session belongs to user
  const sess = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.userId, user.id)))
    .limit(1);

  if (sess.length === 0) {
    return c.json({ error: "Session not found" }, 404);
  }

  const session = sess[0];

  // 2. Fetch steps
  const steps = await db
    .select()
    .from(agentStep)
    .where(eq(agentStep.sessionId, sessionId))
    .orderBy(asc(agentStep.stepNumber));

  if (steps.length === 0) {
    return c.json({ error: "Session has no steps" }, 400);
  }

  // 3. Extract dominant packageName
  const pkgCounts = new Map<string, number>();
  for (const step of steps) {
    if (step.packageName) {
      pkgCounts.set(step.packageName, (pkgCounts.get(step.packageName) ?? 0) + 1);
    }
  }
  let packageName = "unknown";
  let maxCount = 0;
  for (const [pkg, count] of pkgCounts) {
    if (count > maxCount) {
      packageName = pkg;
      maxCount = count;
    }
  }

  // 4. Fetch user's LLM config
  const configs = await db
    .select()
    .from(llmConfigTable)
    .where(eq(llmConfigTable.userId, user.id))
    .limit(1);

  let llmCfg: LLMConfig;
  if (configs.length > 0) {
    const cfg = configs[0];
    llmCfg = { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model ?? undefined };
  } else if (process.env.LLM_API_KEY) {
    llmCfg = {
      provider: process.env.LLM_PROVIDER ?? "openai",
      apiKey: process.env.LLM_API_KEY,
    };
  } else {
    return c.json({ error: "No LLM provider configured" }, 400);
  }

  // 5. Build transcript (truncate if > 30 steps: first 3 + last 20)
  let transcriptSteps = steps;
  if (steps.length > 30) {
    transcriptSteps = [...steps.slice(0, 3), ...steps.slice(-20)];
  }

  const transcript = transcriptSteps
    .map((s) => {
      const action = JSON.stringify(s.action);
      return `Step ${s.stepNumber}: Action=${action} | Reason=${s.reasoning ?? "—"} | Result=${s.result ?? "—"}`;
    })
    .join("\n");

  const userPrompt = `APP: ${packageName}
GOAL: ${session.goal}
STATUS: ${session.status} (used ${session.stepsUsed ?? steps.length} steps)

TRANSCRIPT:
${transcript}`;

  // 6. Call LLM
  const llm = getLlmProvider(llmCfg);
  let rawResponse: string;
  try {
    rawResponse = await llm.getAction(ANALYSIS_SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    return c.json({ error: `LLM call failed: ${(err as Error).message}` }, 500);
  }

  // 7. Parse response
  let hints: string[] = [];
  let analysis = "";
  try {
    // Extract JSON from response (may have markdown fences)
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      hints = Array.isArray(parsed.hints) ? parsed.hints.slice(0, 5) : [];
      analysis = parsed.analysis ?? "";
    }
  } catch {
    // If parse fails, treat the whole response as analysis
    analysis = rawResponse.slice(0, 500);
  }

  if (hints.length === 0) {
    return c.json({ error: "LLM did not return actionable hints", analysis }, 400);
  }

  // 8. Enforce max 5 hints per (userId, packageName) — delete oldest if over limit
  const existing = await db
    .select({ id: appHint.id })
    .from(appHint)
    .where(and(eq(appHint.userId, user.id), eq(appHint.packageName, packageName)))
    .orderBy(desc(appHint.createdAt));

  const totalAfterInsert = existing.length + hints.length;
  if (totalAfterInsert > 5) {
    const toDelete = existing.slice(5 - hints.length);
    for (const row of toDelete) {
      await db.delete(appHint).where(eq(appHint.id, row.id));
    }
  }

  // 9. Insert new hints
  const insertedHints: { id: string; hint: string }[] = [];
  for (const hint of hints) {
    const id = crypto.randomUUID();
    await db.insert(appHint).values({
      id,
      userId: user.id,
      packageName,
      hint,
      sourceSessionId: sessionId,
    });
    insertedHints.push({ id, hint });
  }

  return c.json({ packageName, hints: insertedHints, analysis });
});

export { investigate };
