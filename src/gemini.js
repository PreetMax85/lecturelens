// Gemini is now used only for the guardrail classification and answer
// generation calls - embeddings moved to local-embed.js (see there for why).
const { createSseParser } = require("./sse");

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
//
// `onText`, if given, switches to the streaming endpoint and is called with
// each piece of text as it arrives. The return value is still the whole text,
// so callers that stream and callers that don't get the same string, and the
// cache key (which ignores callbacks) does not change.
async function generate(prompt, { temperature = 0.2, systemInstruction, onUsage, onText } = {}) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  if (onText) return generateStream(body, { onUsage, onText });

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
  reportUsage(onUsage, data.usageMetadata);
  return candidate.content.parts.map((p) => p.text).join("");
}

function reportUsage(onUsage, usageMetadata) {
  if (onUsage && usageMetadata) {
    onUsage({
      inputTokens: usageMetadata.promptTokenCount ?? 0,
      outputTokens: usageMetadata.candidatesTokenCount ?? 0,
    });
  }
}

// Gemini can stop a stream partway with a content filter (RECITATION, SAFETY)
// after some text has already been sent. That is treated as a failure, the
// same as a blocked non-streamed call, so the caller can take back what the
// student has already seen.
const COMPLETE_FINISHES = new Set(["STOP", "MAX_TOKENS"]);

async function generateStream(body, { onUsage, onText }) {
  const res = await fetch(
    `${BASE}/models/${MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini generate failed: ${res.status} ${await res.text()}`);
  }

  let text = "";
  let usageMetadata = null;
  let finishReason = null;
  let sawCandidate = false;
  const parser = createSseParser((data) => {
    const event = JSON.parse(data);
    // An error after the stream has started comes as an event, not a status.
    if (event.error) {
      throw new Error(`Gemini generate failed: ${event.error.code} ${JSON.stringify(event.error)}`);
    }
    // usageMetadata is a running total, so the last one covers the whole call.
    if (event.usageMetadata) usageMetadata = event.usageMetadata;
    const candidate = event.candidates?.[0];
    if (!candidate) return;
    sawCandidate = true;
    if (candidate.finishReason) finishReason = candidate.finishReason;
    const piece = (candidate.content?.parts || []).map((p) => p.text || "").join("");
    if (piece) {
      text += piece;
      onText(piece);
    }
  });

  const decoder = new TextDecoder();
  for await (const bytes of res.body) parser.push(decoder.decode(bytes, { stream: true }));
  parser.push(decoder.decode());
  parser.end();

  if (!sawCandidate) throw new Error("Gemini returned no candidates (likely blocked)");
  // A stream that closes without a finish reason was cut off, not finished.
  if (!finishReason) throw new Error("Gemini stream ended before the answer finished");
  if (!COMPLETE_FINISHES.has(finishReason)) {
    throw new Error(`Gemini stopped the answer early: ${finishReason}`);
  }
  reportUsage(onUsage, usageMetadata);
  return text;
}

module.exports = { generate, MODEL };
