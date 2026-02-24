/**
 * Skills module for DroidClaw.
 * Multi-step smart actions that reduce LLM decision points and eliminate
 * entire categories of errors (coordinate guessing, wrong submit buttons, etc.)
 *
 * Skills:
 *   submit_message  — Find and tap the Send/Submit button in chat apps
 *   copy_visible_text — Read text from screen elements and set clipboard programmatically
 *   wait_for_content — Wait for new content to appear (AI responses, page loads)
 *   find_and_tap — Find an element by text label and tap it
 *   compose_email — Fill email fields in correct order (To, Subject, Body)
 *   like_nth_comment — Deterministically tap the heart icon for the Nth visible comment row
 *   verify_nth_comment_like — Deterministically verify like state for the Nth visible comment row
 */

import { existsSync, readFileSync } from "fs";
import { Config } from "./config.js";
import { runAdbCommand, getSwipeCoords, type ActionDecision, type ActionResult } from "./actions.js";
import { getInteractiveElements, type UIElement } from "./sanitizer.js";
import { SWIPE_DURATION_MS } from "./constants.js";

/**
 * Routes a skill action to the appropriate skill function.
 */
export function executeSkill(
  decision: ActionDecision,
  elements: UIElement[]
): ActionResult {
  const skill = decision.skill ?? decision.action;
  console.log(`Executing multi-step action: ${skill}`);

  switch (skill) {
    case "read_screen":
      return readScreen(elements);
    case "submit_message":
      return submitMessage(elements);
    case "copy_visible_text":
      return copyVisibleText(decision, elements);
    case "wait_for_content":
      return waitForContent(elements);
    case "find_and_tap":
      return findAndTap(decision, elements);
    case "compose_email":
      return composeEmail(decision, elements);
    case "like_nth_comment":
      return likeNthComment(decision, elements);
    case "verify_nth_comment_like":
      return verifyNthCommentLike(decision, elements);
    default:
      return { success: false, message: `Unknown skill: ${skill}` };
  }
}

// ===========================================
// Helper: re-scan screen
// ===========================================

/**
 * Sets clipboard text via ADB with proper shell escaping.
 * ADB shell joins args into a single string, so parentheses/quotes break it.
 * Wrapping in single quotes and escaping internal quotes fixes this.
 */
function safeClipboardSet(text: string): void {
  const escaped = text.replaceAll("'", "'\\''");
  runAdbCommand(["shell", `cmd clipboard set-text '${escaped}'`]);
}

function rescanScreen(): UIElement[] {
  try {
    runAdbCommand(["shell", "uiautomator", "dump", Config.SCREEN_DUMP_PATH]);
    runAdbCommand(["pull", Config.SCREEN_DUMP_PATH, Config.LOCAL_DUMP_PATH]);
  } catch {
    console.log("Warning: ADB screen capture failed during skill re-scan.");
    return [];
  }
  if (!existsSync(Config.LOCAL_DUMP_PATH)) return [];
  const xmlContent = readFileSync(Config.LOCAL_DUMP_PATH, "utf-8");
  return getInteractiveElements(xmlContent);
}

// ===========================================
// Skill 0: read_screen (scroll + collect all text)
// ===========================================

function readScreen(elements: UIElement[]): ActionResult {
  const allTexts: string[] = [];
  const seenTexts = new Set<string>();

  function collectTexts(els: UIElement[]): number {
    let added = 0;
    for (const el of els) {
      if (el.text && !seenTexts.has(el.text)) {
        seenTexts.add(el.text);
        allTexts.push(el.text);
        added++;
      }
    }
    return added;
  }

  // 1. Collect from initial screen
  collectTexts(elements);

  // 2. Scroll down and collect until no new content
  const swipeCoords = getSwipeCoords();
  const upCoords = swipeCoords["up"]; // swipe up = scroll down = see more below
  const maxScrolls = 5;
  let scrollsDone = 0;

  for (let i = 0; i < maxScrolls; i++) {
    runAdbCommand([
      "shell", "input", "swipe",
      String(upCoords[0]), String(upCoords[1]),
      String(upCoords[2]), String(upCoords[3]),
      SWIPE_DURATION_MS,
    ]);
    Bun.sleepSync(1500);
    scrollsDone++;

    const newElements = rescanScreen();
    const added = collectTexts(newElements);
    console.log(`read_screen: Scroll ${scrollsDone} — found ${added} new text elements`);

    if (added === 0) break;
  }

  const combinedText = allTexts.join("\n");

  // 3. Copy to clipboard for easy access
  if (combinedText.length > 0) {
    safeClipboardSet(combinedText);
  }

  return {
    success: true,
    message: `Read ${allTexts.length} text elements across ${scrollsDone} scrolls (${combinedText.length} chars), copied to clipboard`,
    data: combinedText,
  };
}

// ===========================================
// Skill 1: submit_message
// ===========================================

const SEND_BUTTON_PATTERN = /send|submit|post|arrow|paper.?plane/i;

function submitMessage(elements: UIElement[]): ActionResult {
  // 1. Search for Send/Submit button by text
  let candidates = elements.filter(
    (el) =>
      el.enabled &&
      (el.clickable || el.action === "tap") &&
      (SEND_BUTTON_PATTERN.test(el.text) || SEND_BUTTON_PATTERN.test(el.id))
  );

  // 2. If no text match, look for clickable elements in the bottom 20% of screen
  //    near the right side (common Send button position)
  if (candidates.length === 0) {
    const screenBottom = elements
      .filter((el) => el.enabled && el.clickable)
      .sort((a, b) => b.center[1] - a.center[1]);

    // Take elements in the bottom 20% by Y coordinate
    if (screenBottom.length > 0) {
      const maxY = screenBottom[0].center[1];
      const threshold = maxY * 0.8;
      candidates = screenBottom.filter((el) => el.center[1] >= threshold);
      // Prefer rightmost element (Send buttons are usually on the right)
      candidates.sort((a, b) => b.center[0] - a.center[0]);
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      message: "Could not find a Send/Submit button on screen",
    };
  }

  // 3. Tap the best match
  const target = candidates[0];
  const [x, y] = target.center;
  console.log(
    `submit_message: Tapping "${target.text}" at (${x}, ${y})`
  );
  runAdbCommand(["shell", "input", "tap", String(x), String(y)]);

  // 4. Wait for response to generate
  console.log("submit_message: Waiting 6s for response...");
  Bun.sleepSync(6000);

  // 5. Re-scan screen and check for new content
  const newElements = rescanScreen();
  const originalTexts = new Set(elements.map((el) => el.text).filter(Boolean));
  const newTexts = newElements
    .map((el) => el.text)
    .filter((t) => t && !originalTexts.has(t));

  if (newTexts.length > 0) {
    const summary = newTexts.slice(0, 3).join("; ");
    return {
      success: true,
      message: `Tapped "${target.text}" and new content appeared: ${summary}`,
      data: summary,
    };
  }

  return {
    success: true,
    message: `Tapped "${target.text}" at (${x}, ${y}). No new content yet — may still be loading.`,
  };
}

// ===========================================
// Skill 2: copy_visible_text
// ===========================================

function copyVisibleText(
  decision: ActionDecision,
  elements: UIElement[]
): ActionResult {
  // 1. Filter for readable text elements
  let textElements = elements.filter(
    (el) => el.text && el.action === "read"
  );

  // 2. If query provided, filter to matching elements
  if (decision.query) {
    const query = decision.query.toLowerCase();
    textElements = textElements.filter((el) =>
      el.text.toLowerCase().includes(query)
    );
  }

  // If no read-only text, include all elements with text
  if (textElements.length === 0) {
    textElements = elements.filter((el) => el.text);
    if (decision.query) {
      const query = decision.query.toLowerCase();
      textElements = textElements.filter((el) =>
        el.text.toLowerCase().includes(query)
      );
    }
  }

  if (textElements.length === 0) {
    return {
      success: false,
      message: decision.query
        ? `No text matching "${decision.query}" found on screen`
        : "No readable text found on screen",
    };
  }

  // 3. Sort by vertical position (top to bottom)
  textElements.sort((a, b) => a.center[1] - b.center[1]);

  // 4. Concatenate text
  const combinedText = textElements.map((el) => el.text).join("\n");

  // 5. Set clipboard programmatically
  console.log(
    `copy_visible_text: Copying ${textElements.length} text elements (${combinedText.length} chars)`
  );
  safeClipboardSet(combinedText);

  return {
    success: true,
    message: `Copied ${textElements.length} text elements to clipboard (${combinedText.length} chars)`,
    data: combinedText,
  };
}

// ===========================================
// Skill 3: wait_for_content
// ===========================================

function waitForContent(elements: UIElement[]): ActionResult {
  // 1. Record current element texts
  const originalTexts = new Set(elements.map((el) => el.text).filter(Boolean));

  // 2. Poll up to 5 times (3s intervals = 15s max)
  for (let i = 0; i < 5; i++) {
    console.log(
      `wait_for_content: Waiting 3s... (attempt ${i + 1}/5)`
    );
    Bun.sleepSync(3000);

    // Re-scan screen
    const newElements = rescanScreen();
    const newTexts = newElements
      .map((el) => el.text)
      .filter((t) => t && !originalTexts.has(t));

    // Check if meaningful new content appeared (>20 chars total)
    const totalNewChars = newTexts.reduce((sum, t) => sum + t.length, 0);
    if (totalNewChars > 20) {
      const summary = newTexts.slice(0, 5).join("; ");
      console.log(
        `wait_for_content: Found ${newTexts.length} new text elements (${totalNewChars} chars)`
      );
      return {
        success: true,
        message: `New content appeared after ${(i + 1) * 3}s: ${summary}`,
        data: summary,
      };
    }
  }

  return {
    success: false,
    message: "No new content appeared after 15s",
  };
}

// ===========================================
// Skill 4: find_and_tap
// ===========================================

/**
 * Searches visible elements for a match. Returns the best match or null.
 */
function findMatch(elements: UIElement[], queryLower: string): UIElement | null {
  const matches = elements.filter(
    (el) => el.text && el.text.toLowerCase().includes(queryLower)
  );
  if (matches.length === 0) return null;

  const scored = matches.map((el) => {
    let score = 0;
    if (el.enabled) score += 10;
    if (el.clickable || el.longClickable) score += 5;
    if (el.text.toLowerCase() === queryLower) score += 20;
    else score += 5;
    return { el, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].el;
}

function findAndTap(
  decision: ActionDecision,
  elements: UIElement[]
): ActionResult {
  const query = decision.query;
  if (!query) {
    return { success: false, message: "find_and_tap requires a query" };
  }

  const queryLower = query.toLowerCase();

  // 1. Check current screen first
  let best = findMatch(elements, queryLower);

  // 2. If not found, scroll down and re-check (up to 10 scrolls)
  if (!best) {
    const swipeCoords = getSwipeCoords();
    const upCoords = swipeCoords["up"]; // swipe up = scroll down
    const maxScrolls = 10;

    for (let i = 0; i < maxScrolls; i++) {
      console.log(`find_and_tap: "${query}" not visible, scrolling down (${i + 1}/${maxScrolls})`);
      runAdbCommand([
        "shell", "input", "swipe",
        String(upCoords[0]), String(upCoords[1]),
        String(upCoords[2]), String(upCoords[3]),
        SWIPE_DURATION_MS,
      ]);
      Bun.sleepSync(1500);

      const freshElements = rescanScreen();
      best = findMatch(freshElements, queryLower);
      if (best) {
        console.log(`find_and_tap: Found "${query}" after ${i + 1} scroll(s)`);
        break;
      }
    }
  }

  if (!best) {
    const available = elements
      .filter((el) => el.text)
      .map((el) => el.text)
      .slice(0, 15);
    return {
      success: false,
      message: `No element matching "${query}" found after scrolling. Available: ${available.join(", ")}`,
    };
  }

  // 3. Tap it
  const [x, y] = best.center;
  console.log(`find_and_tap: Tapping "${best.text}" at (${x}, ${y})`);
  runAdbCommand(["shell", "input", "tap", String(x), String(y)]);

  return {
    success: true,
    message: `Found and tapped "${best.text}" at (${x}, ${y})`,
    data: best.text,
  };
}

// ===========================================
// Skill 5: compose_email
// ===========================================

/** Patterns to identify email compose fields by resource ID */
const TO_FIELD_PATTERN = /to|recipient/i;
const SUBJECT_FIELD_PATTERN = /subject/i;
const BODY_FIELD_PATTERN = /body|compose_area|compose_edit|message_content/i;

/** Patterns to identify fields by hint text */
const TO_HINT_PATTERN = /^to$|recipient|email.?address/i;
const SUBJECT_HINT_PATTERN = /subject/i;
const BODY_HINT_PATTERN = /compose|body|message|write/i;

/**
 * Finds an editable field matching the given ID and hint patterns.
 * Falls back to positional matching if patterns don't match.
 */
function findEmailField(
  editables: UIElement[],
  idPattern: RegExp,
  hintPattern: RegExp
): UIElement | undefined {
  // Try resource ID first (most reliable)
  const byId = editables.find((el) => idPattern.test(el.id));
  if (byId) return byId;
  // Try hint text
  const byHint = editables.find((el) => el.hint && hintPattern.test(el.hint));
  if (byHint) return byHint;
  // Try visible label/text
  const byText = editables.find((el) => idPattern.test(el.text));
  if (byText) return byText;
  return undefined;
}

/** Try to extract an email address from a string */
function extractEmail(text: string): string | null {
  const match = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
  return match ? match[0] : null;
}

function composeEmail(
  decision: ActionDecision,
  elements: UIElement[]
): ActionResult {
  // Resolve email address: try query first, then extract from text
  let emailAddress = decision.query;
  const bodyContent = decision.text;

  if (!emailAddress && bodyContent) {
    const extracted = extractEmail(bodyContent);
    if (extracted) {
      emailAddress = extracted;
      console.log(`compose_email: Extracted email "${emailAddress}" from text field`);
    }
  }

  if (!emailAddress) {
    return {
      success: false,
      message: "compose_email requires query (email address). Example: {\"action\": \"compose_email\", \"query\": \"user@example.com\"}",
    };
  }

  // Always use mailto: intent — this is the most reliable path.
  // It opens the default email app with To pre-filled, regardless of current screen.
  console.log(`compose_email: Launching mailto:${emailAddress}`);
  runAdbCommand([
    "shell", "am", "start", "-a", "android.intent.action.SENDTO",
    "-d", `mailto:${emailAddress}`,
  ]);
  Bun.sleepSync(2500);

  // Re-scan to find the compose screen
  const freshElements = rescanScreen();
  const editables = freshElements
    .filter((el) => el.editable && el.enabled)
    .sort((a, b) => a.center[1] - b.center[1]);

  if (editables.length === 0) {
    return { success: false, message: "Launched email compose but no editable fields appeared" };
  }

  // Find the body field — mailto: already handled the To field
  let bodyField = findEmailField(editables, BODY_FIELD_PATTERN, BODY_HINT_PATTERN);
  if (!bodyField) {
    // Positional fallback: body is the last/largest editable field
    bodyField = editables[editables.length - 1];
  }

  const [bx, by] = bodyField.center;
  console.log(`compose_email: Tapping Body field at (${bx}, ${by})`);
  runAdbCommand(["shell", "input", "tap", String(bx), String(by)]);
  Bun.sleepSync(300);

  // Paste body content — use explicit text if provided, otherwise paste clipboard
  if (bodyContent) {
    safeClipboardSet(bodyContent);
    Bun.sleepSync(200);
  }
  runAdbCommand(["shell", "input", "keyevent", "279"]); // KEYCODE_PASTE

  return {
    success: true,
    message: `Email compose opened to ${emailAddress}, body pasted`,
  };
}

// ===========================================
// Skill 6: like_nth_comment / verify_nth_comment_like
// ===========================================

let lastCommentLikeAttempt:
  | { index: number; y: number; x: number; countBefore: number | null }
  | null = null;

function parseNthCommentIndex(decision: ActionDecision): number {
  const raw = decision.query ?? decision.text ?? "";
  const match = String(raw).match(/\d+/);
  const n = match ? Number.parseInt(match[0], 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function parseFirstInt(text: string): number | null {
  const match = text.match(/\b\d[\d,]*\b/);
  if (!match) return null;
  return Number.parseInt(match[0].replaceAll(",", ""), 10);
}

function getScreenApprox(elements: UIElement[]): { width: number; height: number } {
  let maxX = 1080;
  let maxY = 2400;
  for (const el of elements) {
    const [x, y] = el.center;
    const [w, h] = el.size;
    maxX = Math.max(maxX, x + Math.max(0, Math.floor(w / 2)));
    maxY = Math.max(maxY, y + Math.max(0, Math.floor(h / 2)));
  }
  return { width: maxX, height: maxY };
}

function isCommentLikeButton(el: UIElement, screenWidth: number): boolean {
  const hay = `${el.text} ${el.id} ${el.hint}`.toLowerCase();
  const isLike = hay.includes("like");
  if (!isLike) return false;
  if (hay.includes("video like") || hay.includes("like video") || hay.includes("repost")) return false;
  if (el.center[0] < screenWidth * 0.72) return false;
  if (el.center[1] < 900) return false; // avoid top/header/main video controls
  if (el.center[1] > 2300) return false; // avoid bottom composer bar
  return el.clickable || el.action === "tap" || /like or undo like/i.test(el.text);
}

function collectCommentLikeRows(elements: UIElement[]): UIElement[] {
  const { width } = getScreenApprox(elements);
  const candidates = elements
    .filter((el) => isCommentLikeButton(el, width))
    .sort((a, b) => a.center[1] - b.center[1] || b.center[0] - a.center[0]);

  // Deduplicate near-identical rows; keep the rightmost candidate in each row bucket.
  const rows: UIElement[] = [];
  for (const el of candidates) {
    const existingIdx = rows.findIndex((r) => Math.abs(r.center[1] - el.center[1]) <= 24);
    if (existingIdx === -1) {
      rows.push(el);
      continue;
    }
    if (el.center[0] > rows[existingIdx].center[0]) {
      rows[existingIdx] = el;
    }
  }

  return rows.sort((a, b) => a.center[1] - b.center[1]);
}

function findNearbyCommentCount(elements: UIElement[], target: UIElement): number | null {
  const nearby = elements.filter((el) => {
    if (!el.text) return false;
    if (Math.abs(el.center[1] - target.center[1]) > 70) return false;
    if (el.center[0] < target.center[0] - 180) return false;
    if (el.center[0] > target.center[0] + 40) return false;
    return true;
  });

  for (const el of nearby) {
    const n = parseFirstInt(el.text);
    if (n != null) return n;
  }
  return null;
}

function likeNthComment(decision: ActionDecision, elements: UIElement[]): ActionResult {
  const index = parseNthCommentIndex(decision);
  const rows = collectCommentLikeRows(elements);
  if (rows.length < index) {
    return {
      success: false,
      message: `Only found ${rows.length} visible comment-like buttons; need ${index}`,
    };
  }

  const target = rows[index - 1];
  const [x, y] = target.center;
  const countBefore = findNearbyCommentCount(elements, target);
  console.log(`like_nth_comment: Tapping comment #${index} heart at (${x}, ${y})`);
  runAdbCommand(["shell", "input", "tap", String(x), String(y)]);
  lastCommentLikeAttempt = { index, x, y, countBefore };

  return {
    success: true,
    message: `Tapped heart for visible comment #${index} at (${x}, ${y})`,
    data: JSON.stringify({ x, y, countBefore }),
  };
}

function verifyNthCommentLike(decision: ActionDecision, elements: UIElement[]): ActionResult {
  const index = parseNthCommentIndex(decision);
  const rows = collectCommentLikeRows(elements);
  if (rows.length < index) {
    return {
      success: false,
      message: `Could not verify: only found ${rows.length} visible comment-like buttons; need ${index}`,
    };
  }

  let target = rows[index - 1];
  if (lastCommentLikeAttempt && lastCommentLikeAttempt.index === index) {
    const nearest = rows
      .map((row) => ({ row, dy: Math.abs(row.center[1] - lastCommentLikeAttempt!.y) }))
      .sort((a, b) => a.dy - b.dy)[0];
    if (nearest && nearest.dy <= 80) target = nearest.row;
  }

  const hay = `${target.text} ${target.id} ${target.hint}`.toLowerCase();
  const countNow = findNearbyCommentCount(elements, target);
  const selectedLike =
    target.selected || target.checked || hay.includes("undo like") || hay.includes("liked");

  const countChanged =
    lastCommentLikeAttempt &&
    lastCommentLikeAttempt.index === index &&
    lastCommentLikeAttempt.countBefore != null &&
    countNow != null &&
    countNow !== lastCommentLikeAttempt.countBefore;

  if (selectedLike || countChanged) {
    return {
      success: true,
      message: `Comment #${index} like verified (${selectedLike ? "selected" : "count changed"})`,
      data: JSON.stringify({ selectedLike, countNow }),
    };
  }

  return {
    success: false,
    message: `Comment #${index} like not confirmed yet`,
    data: JSON.stringify({ selectedLike, countNow }),
  };
}
