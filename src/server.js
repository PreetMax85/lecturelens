require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");

const { handleChat } = require("./chat");
const { embedText } = require("./local-embed");

const app = express();
// Single proxy (Render) in front of the app, so per-IP limiting sees the
// real client IP instead of the proxy's. Must be a number, never `true`.
app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  })
);
// Express already defaults to 100kb; stated explicitly so the cap is visible.
app.use(express.json({ limit: "100kb" }));

// One visitor looping burns ~5 Gemini calls per question against a 500/day
// free quota, so both limiters return the same friendly shape the frontend
// already renders as a failed reply. /health is left unlimited.
const TOO_BUSY = "Too many questions right now — wait a minute and try again.";
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30, // ~3 questions/min average, bursts OK for follow-ups
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: TOO_BUSY },
});
// Soft global backstop for several visitors at once. In-memory only, so it
// resets on restart/sleep — the per-IP limiter above is the real control.
const dailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 90, // ~450 Gemini calls, headroom below the 500/day free quota
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: () => "global-chat",
  message: { error: "Daily question budget reached — try again tomorrow." },
});

const MAX_MESSAGE_CHARS = 2000;

function isHistoryEntry(h) {
  return (
    h &&
    typeof h === "object" &&
    (h.role === "user" || h.role === "assistant") &&
    typeof h.content === "string" &&
    h.content.length <= MAX_MESSAGE_CHARS
  );
}

function readChatRequest(req, res) {
  const { message, history } = req.body ?? {};
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return null;
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    res.status(400).json({ error: `message must be under ${MAX_MESSAGE_CHARS} characters` });
    return null;
  }
  const cleanHistory = Array.isArray(history) ? history.filter(isHistoryEntry).slice(-8) : [];
  return { message, history: cleanHistory };
}

app.post("/chat", chatLimiter, dailyLimiter, async (req, res) => {
  const request = readChatRequest(req, res);
  if (!request) return;

  try {
    res.json(await handleChat(request.message, request.history));
  } catch (err) {
    console.error("[/chat] error:", err);
    res.status(500).json({ error: "Something went wrong answering that." });
  }
});

// The same turn as /chat, sent as server-sent events while it happens:
// "sources", then one "delta" per piece of the answer, then "done" with the
// full result (including the citation check, which needs the whole answer),
// or "error". A POST, so the browser reads it with fetch, not EventSource.
app.post("/chat/stream", chatLimiter, dailyLimiter, async (req, res) => {
  const request = readChatRequest(req, res);
  if (!request) return;

  res.set({
    "Content-Type": "text/event-stream",
    // no-transform and X-Accel-Buffering ask any proxy in between not to
    // compress or hold back the stream.
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    const result = await handleChat(request.message, request.history, { emit: send });
    send({ type: "done", ...result });
  } catch (err) {
    console.error("[/chat/stream] error:", err);
    send({ type: "error", error: "Something went wrong answering that." });
  }
  res.end();
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
if (!process.env.QDRANT_URL || !process.env.GEMINI_API_KEY) {
  console.warn("[startup] QDRANT_URL or GEMINI_API_KEY not set - chat requests will fail");
}
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Load the embedding model now rather than on the first question, so a
  // visitor who wakes the server isn't also waiting on model init.
  embedText("warmup").catch((err) => console.error("[startup] embedder warmup failed:", err.message));
});