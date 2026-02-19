import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./sessions.js";

// ── Types ────────────────────────────────────────────────

interface VoiceSession {
  chunks: Buffer[];
  totalBytes: number;
  partialTimer: ReturnType<typeof setInterval> | null;
  lastPartialOffset: number;
}

// ── State ────────────────────────────────────────────────

const activeSessions = new Map<string, VoiceSession>();

// ── Audio constants ──────────────────────────────────────

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const PARTIAL_INTERVAL_MS = 2_000;
/** Minimum bytes before attempting first transcription (100ms of 16kHz mono 16-bit) */
const MIN_AUDIO_BYTES = 3_200;

// ── Exported handlers ────────────────────────────────────

/**
 * Start a voice session for a device. Creates a buffer and starts a
 * periodic timer that sends accumulated audio to Groq Whisper for
 * partial transcripts every ~2s.
 */
export function handleVoiceStart(
  ws: ServerWebSocket<WebSocketData>,
  deviceId: string,
  groqApiKey: string
): void {
  // Clean up any existing session for this device
  cleanupSession(deviceId);

  const session: VoiceSession = {
    chunks: [],
    totalBytes: 0,
    partialTimer: null,
    lastPartialOffset: 0,
  };

  activeSessions.set(deviceId, session);

  // Start periodic partial transcription
  session.partialTimer = setInterval(async () => {
    // Only transcribe if there's new audio since last partial
    if (session.totalBytes <= session.lastPartialOffset) return;
    if (session.totalBytes < MIN_AUDIO_BYTES) return;

    try {
      const pcm = concatChunks(session.chunks);
      const text = await transcribeAudio(pcm, groqApiKey);
      session.lastPartialOffset = session.totalBytes;

      if (text) {
        sendToDevice(ws, { type: "transcript_partial", text });
      }
    } catch (err) {
      console.error(`[Voice] Partial transcription failed for ${deviceId}:`, err);
    }
  }, PARTIAL_INTERVAL_MS);
}

/**
 * Append a base64-encoded PCM audio chunk to the session buffer.
 */
export function handleVoiceChunk(deviceId: string, base64Data: string): void {
  const session = activeSessions.get(deviceId);
  if (!session) {
    console.warn(`[Voice] Chunk received for unknown session: ${deviceId}`);
    return;
  }

  const decoded = Buffer.from(base64Data, "base64");
  session.chunks.push(decoded);
  session.totalBytes += decoded.length;
}

/**
 * Stop the partial timer, send the complete audio to Groq for a final
 * transcript, relay it to the device, clean up, and return the text.
 */
export async function handleVoiceSend(
  ws: ServerWebSocket<WebSocketData>,
  deviceId: string,
  groqApiKey: string
): Promise<string> {
  const session = activeSessions.get(deviceId);
  if (!session) {
    console.warn(`[Voice] Send requested for unknown session: ${deviceId}`);
    return "";
  }

  // Stop partial timer
  if (session.partialTimer !== null) {
    clearInterval(session.partialTimer);
    session.partialTimer = null;
  }

  let transcript = "";

  if (session.totalBytes >= MIN_AUDIO_BYTES) {
    try {
      const pcm = concatChunks(session.chunks);
      transcript = await transcribeAudio(pcm, groqApiKey);
    } catch (err) {
      console.error(`[Voice] Final transcription failed for ${deviceId}:`, err);
    }
  }

  sendToDevice(ws, { type: "transcript_final", text: transcript });

  // Clean up session
  activeSessions.delete(deviceId);

  return transcript;
}

/**
 * Cancel a voice session: stop the timer and discard all audio.
 */
export function handleVoiceCancel(deviceId: string): void {
  cleanupSession(deviceId);
}

// ── Internal helpers ─────────────────────────────────────

/**
 * Concatenate all buffered chunks into a single Buffer.
 */
function concatChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat(chunks);
}

/**
 * Clean up and remove a voice session.
 */
function cleanupSession(deviceId: string): void {
  const session = activeSessions.get(deviceId);
  if (!session) return;

  if (session.partialTimer !== null) {
    clearInterval(session.partialTimer);
  }
  activeSessions.delete(deviceId);
}

/**
 * Wrap raw PCM data in a WAV container and send it to Groq's
 * Whisper API for transcription. Returns the transcribed text.
 */
async function transcribeAudio(pcmBuffer: Buffer, apiKey: string): Promise<string> {
  const wav = pcmToWav(pcmBuffer, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);

  const formData = new FormData();
  const wavBytes = new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength) as BlobPart;
  formData.append("file", new Blob([wavBytes], { type: "audio/wav" }), "audio.wav");
  formData.append("model", "whisper-large-v3");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq Whisper API error ${response.status}: ${body}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text ?? "";
}

/**
 * Create a 44-byte WAV header + PCM data buffer.
 */
function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const headerSize = 44;

  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4); // file size - 8
  buffer.write("WAVE", 8);

  // fmt subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // subchunk1 size (PCM = 16)
  buffer.writeUInt16LE(1, 20); // audio format (PCM = 1)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // PCM data
  pcm.copy(buffer, headerSize);

  return buffer;
}

/**
 * Send a JSON message to a device WebSocket (safe — catches send errors).
 */
function sendToDevice(ws: ServerWebSocket<WebSocketData>, msg: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // device disconnected
  }
}
