require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { checkGuardrail } = require("./guardrail");
const { answerQuestion } = require("./answer");
const { embedText } = require("./local-embed");

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
  })
);
app.use(express.json());

app.post("/chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const safeHistory = Array.isArray(history) ? history : [];

  try {
    const allowed = await checkGuardrail(message, safeHistory);
    if (!allowed) {
      return res.json({
        answer:
          "I can only help with questions about this course's content — what topic are you curious about?",
        sources: [],
        blocked: true,
      });
    }

    const result = await answerQuestion(message, safeHistory);
    res.json(result);
  } catch (err) {
    console.error("[/chat] error:", err);
    res.status(500).json({ error: "Something went wrong answering that." });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Load the embedding model now rather than on the first question, so a
  // visitor who wakes the server isn't also waiting on model init.
  embedText("warmup").catch((err) => console.error("[startup] embedder warmup failed:", err.message));
});