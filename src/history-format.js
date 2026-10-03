// Shared conversation formatter: "Student:" / "Assistant:" lines for prompts.
function formatHistory(history, limit) {
  return history
    .slice(-limit)
    .map((h) => `${h.role === "user" ? "Student" : "Assistant"}: ${h.content}`)
    .join("\n");
}

module.exports = { formatHistory };
