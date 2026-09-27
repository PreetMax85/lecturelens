// The recent conversation sent with each question, so the backend can
// resolve follow-ups like "what about on iOS?". Only complete exchanges are
// sent: a reply that failed, and a question whose reply never arrived (lost
// to a reload mid-answer, say), would otherwise read as real turns.
const HISTORY_LIMIT = 8;

export function chatHistory(messages, greeting) {
  const turns = [];
  messages.forEach((m, i) => {
    if (m.role === "user") {
      const reply = messages[i + 1];
      if (reply?.role === "assistant" && !reply.failed && !reply.pending) turns.push(m);
    } else if (m.role === "assistant" && !m.failed && !m.pending && m.content !== greeting) {
      turns.push(m);
    }
  });
  return turns.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content }));
}
