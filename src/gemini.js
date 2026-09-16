// Gemini is now used only for the guardrail classification and answer
// generation calls - embeddings moved to local-embed.js (see there for why).
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-3.1-flash-lite";

if (!GEMINI_KEY) {
  console.warn("[gemini] GEMINI_API_KEY not set - calls will fail");
}

// LLM generation. temperature low for factual/grounded answers.
//
// `onUsage`, if given, is called with the token counts Gemini reports for this
// call. It is a callback rather than part of the return value so that generate
// keeps returning a plain string: eval/llm-cache.js caches that string by
// value, and widening the return type would invalidate the committed cache.
async function generate(prompt, { temperature = 0.2, systemInstruction, onUsage } = {}) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(
    `${BASE}/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini generate failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("Gemini returned no candidates (likely blocked)");
  if (onUsage && data.usageMetadata) {
    onUsage({
      inputTokens: data.usageMetadata.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
    });
  }
  return candidate.content.parts.map((p) => p.text).join("");
}

module.exports = { generate, MODEL };
