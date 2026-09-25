const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";
const { generate } = require("./gemini");

// The shape of a real streamGenerateContent?alt=sse chunk. usageMetadata is a
// running total, so the last chunk carries the counts for the whole call.
function chunk(text, { outputTokens, finishReason } = {}) {
  const candidate = { content: text == null ? {} : { parts: [{ text }], role: "model" }, index: 0 };
  if (finishReason) candidate.finishReason = finishReason;
  return {
    candidates: [candidate],
    usageMetadata: { promptTokenCount: 14, candidatesTokenCount: outputTokens, totalTokenCount: 14 + outputTokens },
  };
}

// Serves the events as bytes split at awkward places, the way the network
// does, or at the given byte offsets.
function stubFetch(t, events, cuts = [7, 60]) {
  const body = new TextEncoder().encode(
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join("")
  );
  const bounds = [0, ...cuts, body.length];
  const pieces = bounds.slice(1).map((end, i) => body.slice(bounds[i], end));
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const stream = new ReadableStream({
      start(controller) {
        for (const p of pieces) controller.enqueue(p);
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });
  return calls;
}

test("with onText, streams each piece of text in order and returns the whole answer", async (t) => {
  const calls = stubFetch(t, [
    chunk("React Native ", { outputTokens: 3 }),
    chunk("uses Expo.", { outputTokens: 6 }),
    chunk(null, { outputTokens: 6, finishReason: "STOP" }),
  ]);
  const pieces = [];
  const answer = await generate("q", { onText: (text) => pieces.push(text) });
  assert.deepEqual(pieces, ["React Native ", "uses Expo."]);
  assert.equal(answer, "React Native uses Expo.");
  assert.match(calls[0].url, /:streamGenerateContent\?alt=sse&/);
});

test("with onText, reports the token counts of the last chunk once", async (t) => {
  stubFetch(t, [
    chunk("a", { outputTokens: 3 }),
    chunk("b", { outputTokens: 9, finishReason: "STOP" }),
  ]);
  const usage = [];
  await generate("q", { onText: () => {}, onUsage: (u) => usage.push(u) });
  assert.deepEqual(usage, [{ inputTokens: 14, outputTokens: 9 }]);
});

test("with onText, throws when Gemini cuts the answer off after streaming part of it", async (t) => {
  stubFetch(t, [
    chunk("one, two, ", { outputTokens: 13 }),
    chunk(null, { outputTokens: 13, finishReason: "RECITATION" }),
  ]);
  await assert.rejects(() => generate("q", { onText: () => {} }), /RECITATION/);
});

test("with onText, a MAX_TOKENS finish still returns the text it got", async (t) => {
  stubFetch(t, [chunk("long answer", { outputTokens: 5, finishReason: "MAX_TOKENS" })]);
  assert.equal(await generate("q", { onText: () => {} }), "long answer");
});

test("with onText, a character split across two network chunks arrives whole", async (t) => {
  const events = [chunk("at 04:12 – 05:30", { outputTokens: 5, finishReason: "STOP" })];
  const raw = new TextEncoder().encode(`data: ${JSON.stringify(events[0])}`);
  // Cut inside the three bytes of the en dash.
  const dash = raw.indexOf(0xe2);
  stubFetch(t, events, [dash + 1]);
  assert.equal(await generate("q", { onText: () => {} }), "at 04:12 – 05:30");
});

test("with onText, throws when the stream ends without saying the answer is finished", async (t) => {
  stubFetch(t, [chunk("half an answ", { outputTokens: 4 })]);
  await assert.rejects(() => generate("q", { onText: () => {} }), /ended before/);
});

test("with onText, throws when Gemini reports an error partway through the stream", async (t) => {
  stubFetch(t, [
    chunk("half an answ", { outputTokens: 4 }),
    { error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } },
  ]);
  await assert.rejects(() => generate("q", { onText: () => {} }), /503/);
});
