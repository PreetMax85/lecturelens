import { useState, useRef, useEffect } from "react";
import CourseHeader from "./CourseHeader.jsx";

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

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [GREETING];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : [GREETING];
  } catch {
    return [GREETING];
  }
}

export default function App() {
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState("checking"); // checking | waking | ready | down
  const bottomRef = useRef(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full or unavailable - non-fatal, chat just won't persist
    }
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages
            .filter((m) => (m.role === "user" || m.role === "assistant") && m.content !== GREETING.content)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.answer || data.error || "Something went wrong.",
          sources: data.sources || [],
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Couldn't reach the server. Is it running?", sources: [] },
      ]);
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
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="bubble">
                <p>{m.content}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="sources">
                    {m.sources.map((s, j) => (
                      <span key={j} className="source-tag">
                        {s.module} → {s.lesson} @ {s.timestamp}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message assistant">
              <div className="bubble typing">Thinking…</div>
            </div>
          )}
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