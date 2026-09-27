require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { handleChat } = require("./chat");
const { embedText } = require("./local-embed");

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
  })
);
app.use(express.json());

function readChatRequest(req, res) {
  const { message, history } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return null;
  }
  return { message, history: Array.isArray(history) ? history : [] };
}

app.post("/chat", async (req, res) => {
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
app.post("/chat/stream", async (req, res) => {
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
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Load the embedding model now rather than on the first question, so a
  // visitor who wakes the server isn't also waiting on model init.
  embedText("warmup").catch((err) => console.error("[startup] embedder warmup failed:", err.message));
});