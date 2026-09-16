const test = require("node:test");
const assert = require("node:assert");

const { createTrace, NOOP_TRACE } = require("./trace");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("span returns the wrapped function's value untouched", async () => {
  const trace = createTrace();
  const value = await trace.span("embed", async () => ({ vector: [1, 2, 3] }));
  assert.deepStrictEqual(value, { vector: [1, 2, 3] });
});

test("span records roughly how long the function took", async () => {
  const trace = createTrace();
  await trace.span("rerank", () => sleep(25));
  const [span] = trace.spans();
  assert.strictEqual(span.name, "rerank");
  assert.ok(span.ms >= 20, `expected at least 20ms, got ${span.ms}`);
});

test("a throwing span still records its time and rethrows", async () => {
  const trace = createTrace();
  await assert.rejects(
    () => trace.span("answer", async () => { throw new Error("boom"); }),
    /boom/
  );
  assert.strictEqual(trace.spans().length, 1);
  assert.strictEqual(trace.spans()[0].name, "answer");
});

test("repeated span names are kept separately", async () => {
  const trace = createTrace();
  await trace.span("search", () => sleep(1));
  await trace.span("search", () => sleep(1));
  assert.strictEqual(trace.spans().length, 2);
  assert.deepStrictEqual(trace.spans().map((s) => s.name), ["search", "search"]);
});

test("totalMs per stage sums repeats of the same name", async () => {
  const trace = createTrace();
  await trace.span("search", () => sleep(10));
  await trace.span("search", () => sleep(10));
  await trace.span("rerank", () => sleep(5));
  // Compared against the recorded spans rather than the sleep lengths: timers
  // fire off a millisecond-rounded loop clock, so a 10 ms sleep can measure
  // 9.8 ms on hrtime and a fixed threshold fails now and then.
  const spans = trace.spans();
  const sumOf = (name) => spans.filter((s) => s.name === name).reduce((a, s) => a + s.ms, 0);
  const totals = trace.stageTotals();
  assert.strictEqual(totals.search, sumOf("search"));
  assert.strictEqual(totals.rerank, sumOf("rerank"));
  assert.ok(totals.search > spans.find((s) => s.name === "search").ms);
});

test("usage records token counts under a stage name", () => {
  const trace = createTrace();
  trace.usage("hyde", { inputTokens: 120, outputTokens: 45 });
  assert.deepStrictEqual(trace.tokenTotals(), {
    hyde: { inputTokens: 120, outputTokens: 45 },
  });
});

test("usage sums repeated calls for the same stage", () => {
  const trace = createTrace();
  trace.usage("search", { inputTokens: 10, outputTokens: 1 });
  trace.usage("search", { inputTokens: 5, outputTokens: 2 });
  assert.deepStrictEqual(trace.tokenTotals().search, {
    inputTokens: 15,
    outputTokens: 3,
  });
});

test("usage ignores a missing usage object, so a call that reports nothing is not counted as zero", () => {
  const trace = createTrace();
  trace.usage("rerank", null);
  trace.usage("rerank", undefined);
  assert.deepStrictEqual(trace.tokenTotals(), {});
});

test("onUsage hands back a callback bound to one stage", () => {
  const trace = createTrace();
  const report = trace.onUsage("condense");
  report({ inputTokens: 7, outputTokens: 3 });
  assert.deepStrictEqual(trace.tokenTotals().condense, {
    inputTokens: 7,
    outputTokens: 3,
  });
});

test("wallMs covers the whole trace, not the sum of its stages", async () => {
  const trace = createTrace();
  // Two concurrent 30ms spans: the stage sum is ~60ms, the wall clock ~30ms.
  await Promise.all([
    trace.span("embed", () => sleep(30)),
    trace.span("hyde", () => sleep(30)),
  ]);
  const wall = trace.wallMs();
  const summed = trace.spans().reduce((a, s) => a + s.ms, 0);
  assert.ok(wall >= 25, `expected wall >= 25, got ${wall}`);
  assert.ok(summed > wall, `expected stage sum ${summed} to exceed wall ${wall}`);
});

test("the no-op trace runs the function and records nothing", async () => {
  const value = await NOOP_TRACE.span("answer", async () => 42);
  assert.strictEqual(value, 42);
  NOOP_TRACE.usage("answer", { inputTokens: 1, outputTokens: 1 });
  NOOP_TRACE.onUsage("answer")({ inputTokens: 1, outputTokens: 1 });
  assert.deepStrictEqual(NOOP_TRACE.spans(), []);
  assert.deepStrictEqual(NOOP_TRACE.tokenTotals(), {});
});
