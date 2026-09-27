const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";
const { handleChat, BLOCKED_ANSWER } = require("./chat");
const { createTrace } = require("./trace");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESULTS = [
  {
    id: 1,
    score: 0.8,
    payload: {
      module: "Module 13",
      lesson: "Implementing Google OAuth",
      timestamp: "04:12",
      start: 252,
      end: 330,
      text: "Set up the redirect URI.",
    },
  },
];
const ANSWER = "Use a redirect URI (Module 13, Lesson: Implementing Google OAuth, at 04:12 – 05:30).";

// A stand-in for Gemini that answers the guardrail after `guardrailMs` and
// streams ANSWER in two pieces. The guardrail is the only call here with a
// system instruction. Every call is logged with when it started.
function fakeLlm({ verdict = "ALLOW", guardrailMs = 0 } = {}) {
  const calls = [];
  const started = Date.now();
  async function llm(prompt, opts = {}) {
    const kind = opts.systemInstruction ? "guardrail" : "answer";
    calls.push({ kind, at: Date.now() - started });
    if (kind === "guardrail") {
      await sleep(guardrailMs);
      calls.push({ kind: "guardrail-done", at: Date.now() - started });
      return verdict;
    }
    const half = ANSWER.length / 2;
    opts.onText?.(ANSWER.slice(0, half));
    opts.onText?.(ANSWER.slice(half));
    return ANSWER;
  }
  return { llm, calls };
}

function fakeRetrieve({ ms = 0, error = null, log = [] } = {}) {
  return async (message, history, opts) => {
    log.push({ event: "retrieve-start", opts });
    await sleep(ms);
    log.push({ event: "retrieve-done", cancelled: opts.cancelled() });
    if (error) throw error;
    return { results: RESULTS };
  };
}

test("an allowed question sends its sources, then the streamed answer, and returns the full result", async () => {
  const { llm } = fakeLlm();
  const events = [];
  const result = await handleChat("how do I set up OAuth?", [], {
    llm,
    retrieve: fakeRetrieve(),
    emit: (e) => events.push(e),
  });

  assert.deepEqual(events.map((e) => e.type), ["sources", "delta", "delta"]);
  assert.equal(events[0].sources[0].lesson, "Implementing Google OAuth");
  assert.equal(events.slice(1).map((e) => e.text).join(""), ANSWER);
  assert.equal(result.answer, ANSWER);
  assert.equal(result.citationCheck.verified, 1);
  assert.equal(result.blocked, undefined);
});

test("retrieval starts while the guardrail is still deciding", async () => {
  const { llm, calls } = fakeLlm({ guardrailMs: 40 });
  // One shared log, so the order of the two is visible.
  await handleChat("q", [], { llm, retrieve: fakeRetrieve({ log: calls }) });
  const order = calls.map((c) => c.kind || c.event);
  assert.ok(
    order.indexOf("retrieve-start") < order.indexOf("guardrail-done"),
    `order was ${order.join(", ")}`
  );
});

test("the answer call waits for the guardrail even when retrieval finishes first", async () => {
  const { llm, calls } = fakeLlm({ guardrailMs: 40 });
  await handleChat("q", [], { llm, retrieve: fakeRetrieve({ ms: 0 }) });
  const guardrailDone = calls.find((c) => c.kind === "guardrail-done");
  const answer = calls.find((c) => c.kind === "answer");
  assert.ok(answer.at >= guardrailDone.at, `answer started at ${answer.at}ms, guardrail passed at ${guardrailDone.at}ms`);
});

test("a rejected question gets the refusal and never reaches the answer call", async () => {
  const { llm, calls } = fakeLlm({ verdict: "REJECT", guardrailMs: 10 });
  const events = [];
  const result = await handleChat("best pasta recipe?", [], {
    llm,
    retrieve: fakeRetrieve({ ms: 0 }),
    emit: (e) => events.push(e),
  });
  assert.deepEqual(result, { answer: BLOCKED_ANSWER, sources: [], blocked: true });
  assert.equal(calls.filter((c) => c.kind === "answer").length, 0);
  assert.deepEqual(events, []);
});

test("retrieval still running when the guardrail rejects is told to stop", async () => {
  const { llm } = fakeLlm({ verdict: "REJECT", guardrailMs: 0 });
  const log = [];
  await handleChat("q", [], { llm, retrieve: fakeRetrieve({ ms: 30, log }) });
  await sleep(50); // let the abandoned retrieval reach its check
  assert.equal(log.find((e) => e.event === "retrieve-done").cancelled, true);
});

test("a retrieval failure after a rejection is not reported, because its result was never needed", async () => {
  const { llm } = fakeLlm({ verdict: "REJECT", guardrailMs: 0 });
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const result = await handleChat("q", [], {
      llm,
      retrieve: fakeRetrieve({ ms: 10, error: new Error("qdrant down") }),
    });
    await sleep(30);
    assert.equal(result.blocked, true);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a retrieval failure on an allowed question is thrown to the caller", async () => {
  const { llm } = fakeLlm();
  await assert.rejects(
    () => handleChat("q", [], { llm, retrieve: fakeRetrieve({ error: new Error("qdrant down") }) }),
    /qdrant down/
  );
});

test("marks when the sources and the first word went out", async () => {
  const { llm } = fakeLlm();
  const trace = createTrace();
  await handleChat("q", [], { llm, trace, retrieve: fakeRetrieve() });
  const marks = trace.marks();
  assert.ok(marks.sources >= 0);
  assert.ok(marks["first-token"] >= marks.sources);
});
