import { useState, useRef, useEffect } from "react";
import CourseHeader from "./CourseHeader.jsx";
import { createSseParser } from "./sse.js";
import { chatHistory } from "./history.js";

const API_BASE = import.meta.env.VITE_API_URL || "";
const STORAGE_KEY = "lecturelens_chat_history";

// The backend runs on a free tier that sleeps when idle and takes up to a
// minute to wake. Ping it on page load so it starts waking while the visitor
// reads, and only show the banner if it's actually slow.
const WAKE_BANNER_DELAY_MS = 2500;
const WAKE_RETRY_MS = 3000;
const WAKE_TIMEOUT_MS = 120000;

const GREETING = {
  role: "assistant",
  content: "Hi! Ask me anything about the course — what was covered, or when a topic was taught.",
  sources: [],
};

const FAILED = "Something went wrong answering that.";

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [GREETING];
    // A reply still streaming when the page closed never finished, so drop it.
    const parsed = JSON.parse(raw);
    const kept = Array.isArray(parsed) ? parsed.filter((m) => !m.pending) : [];
    return kept.length ? kept : [GREETING];
  } catch {
    return [GREETING];
  }
}

// Posts a question to /chat/stream and hands each server-sent event to
// onEvent as it arrives: "sources", "delta" (a piece of the answer), then
// "done" or "error". Resolves once the stream ends.
async function streamChat(body, onEvent) {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const parser = createSseParser((data) => onEvent(JSON.parse(data)));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}

export default function App() {
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState("checking"); // checking | waking | ready | down
  const bottomRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const bannerTimer = setTimeout(() => {
      if (!cancelled) setServerStatus((s) => (s === "checking" ? "waking" : s));
    }, WAKE_BANNER_DELAY_MS);

    (async () => {
      const deadline = Date.now() + WAKE_TIMEOUT_MS;
      while (!cancelled && Date.now() < deadline) {
        try {
          const res = await fetch(`${API_BASE}/health`);
          if (res.ok) {
            if (!cancelled) setServerStatus("ready");
            return;
          }
        } catch {
          // still booting (or offline) - retry until the deadline
        }
        await new Promise((r) => setTimeout(r, WAKE_RETRY_MS));
      }
      if (!cancelled) setServerStatus("down");
    })();

    return () => {
      cancelled = true;
      clearTimeout(bannerTimer);
    };
  }, []);

  const streaming = messages.some((m) => m.pending);

  useEffect(() => {
    if (!streaming) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // While an answer streams in, follow it only if the reader is already at
    // the bottom, so scrolling up to reread is not undone by the next words.
    const list = listRef.current;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 150) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, streaming]);

  useEffect(() => {
    // Saved once the reply is complete rather than on every streamed piece.
    if (streaming) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full or unavailable - non-fatal, chat just won't persist
    }
  }, [messages, streaming]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const history = chatHistory(messages, GREETING.content);

    // The reply is added straight away, marked pending, and filled in as the
    // stream arrives. `stage` drives the status line shown before any text.
    const replyId = Date.now();
    const updateReply = (patch) =>
      setMessages((m) => m.map((msg) => (msg.id === replyId ? { ...msg, ...patch(msg) } : msg)));

    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { id: replyId, role: "assistant", content: "", sources: [], pending: true, stage: "searching" },
    ]);
    setInput("");
    setLoading(true);

    let finished = false;
    try {
      await streamChat({ message: text, history }, (event) => {
        if (event.type === "sources") {
          updateReply(() => ({ sources: event.sources, stage: "writing" }));
        } else if (event.type === "delta") {
          updateReply((msg) => ({ content: msg.content + event.text }));
        } else if (event.type === "done") {
          finished = true;
          // The final answer replaces the streamed text, since it is the same
          // text plus whatever arrived after the last delta.
          updateReply(() => ({
            content: event.answer,
            sources: event.sources || [],
            unverified: event.citationCheck?.unverified || [],
            pending: false,
          }));
        } else if (event.type === "error") {
          finished = true;
          // Gemini can cut an answer off partway, so text already shown is
          // taken back rather than left looking complete.
          updateReply(() => ({ content: event.error || FAILED, sources: [], pending: false, failed: true }));
        }
      });
      if (!finished) throw new Error("stream ended without a result");
    } catch (err) {
      // fetch rejects with a TypeError when the request never got through.
      if (!finished) {
        updateReply(() => ({
          content: err instanceof TypeError ? "Couldn't reach the server. Is it running?" : FAILED,
          sources: [],
          pending: false,
          failed: true,
        }));
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([GREETING]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <CourseHeader />
        <button className="clear-chat-btn" onClick={clearChat}>
          Clear chat
        </button>
      </aside>

      <main className="main-panel">
        {serverStatus === "waking" && (
          <div className="server-banner" role="status">
            Waking up the server. The free hosting tier sleeps when idle, so the first load can take up to a
            minute. You can type your question meanwhile.
          </div>
        )}
        {serverStatus === "down" && (
          <div className="server-banner down" role="alert">
            Can't reach the server right now. Try refreshing in a minute.
          </div>
        )}
        <div className="chat-messages" ref={listRef}>
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="bubble">
                <p className={m.pending && !m.content ? "typing" : undefined}>
                  {m.pending && !m.content
                    ? m.stage === "writing"
                      ? "Writing the answer…"
                      : "Searching the lectures…"
                    : m.content}
                </p>
                {m.sources && m.sources.length > 0 && (
                  <div className="sources">
                    {m.sources.map((s, j) => (
                      <span key={j} className="source-tag">
                        {s.module} → {s.lesson} @ {s.timestamp}
                      </span>
                    ))}
                  </div>
                )}
                {m.unverified?.length > 0 && (
                  // ranges of one compound citation share its text, so count distinct texts
                  <p className="citation-warning">
                    {new Set(m.unverified.map((u) => u.text)).size === 1
                      ? "1 citation above doesn't match the excerpts it was based on, so double-check it."
                      : `${new Set(m.unverified.map((u) => u.text)).size} citations above don't match the excerpts they were based on, so double-check them.`}
                  </p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the course..."
            rows={1}
          />
          <button onClick={sendMessage} disabled={loading}>
            Send
          </button>
        </div>
      </main>
    </div>
  );
}