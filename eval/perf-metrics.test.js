const test = require("node:test");
const assert = require("node:assert");

const { median, percentile, costUsd, summarizeStages, summarizeWall } = require("./perf-metrics");

test("median of an odd-length sample is the middle value", () => {
  assert.strictEqual(median([5, 1, 3]), 3);
});

test("median of an even-length sample averages the middle two", () => {
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
});

test("median of an empty sample is null rather than zero", () => {
  assert.strictEqual(median([]), null);
});

test("percentile uses nearest rank, so p95 of 20 values is the 19th", () => {
  const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
  assert.strictEqual(percentile(values, 95), 19);
});

test("p100 is the largest value and p50 matches the median", () => {
  const values = [10, 20, 30, 40];
  assert.strictEqual(percentile(values, 100), 40);
  assert.strictEqual(percentile(values, 50), median(values));
});

test("percentile of an empty sample is null", () => {
  assert.strictEqual(percentile([], 95), null);
});

test("costUsd prices input and output tokens separately", () => {
  // 1M input at $0.25 plus 1M output at $1.50
  const cost = costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.strictEqual(cost, 1.75);
});

test("costUsd scales down to realistic per-question counts", () => {
  // 4,000 input + 500 output = 4000/1e6*0.25 + 500/1e6*1.50 = 0.001 + 0.00075
  const cost = costUsd({ inputTokens: 4000, outputTokens: 500 });
  assert.ok(Math.abs(cost - 0.00175) < 1e-9, `got ${cost}`);
});

test("costUsd treats a stage with no LLM call as free", () => {
  assert.strictEqual(costUsd({ inputTokens: 0, outputTokens: 0 }), 0);
  assert.strictEqual(costUsd(undefined), 0);
});

const runs = [
  {
    wallMs: 100,
    stageTotals: { guardrail: 10, rerank: 50 },
    tokenTotals: { guardrail: { inputTokens: 100, outputTokens: 1 }, rerank: { inputTokens: 800, outputTokens: 20 } },
  },
  {
    wallMs: 200,
    stageTotals: { guardrail: 20, rerank: 70 },
    tokenTotals: { guardrail: { inputTokens: 200, outputTokens: 1 }, rerank: { inputTokens: 900, outputTokens: 30 } },
  },
  {
    wallMs: 300,
    stageTotals: { guardrail: 30, rerank: 90 },
    tokenTotals: { guardrail: { inputTokens: 300, outputTokens: 1 }, rerank: { inputTokens: 1000, outputTokens: 40 } },
  },
];

test("summarizeStages reports median and p95 per stage", () => {
  const stages = summarizeStages(runs);
  const guardrail = stages.find((s) => s.stage === "guardrail");
  assert.strictEqual(guardrail.n, 3);
  assert.strictEqual(guardrail.medianMs, 20);
  assert.strictEqual(guardrail.p95Ms, 30);
});

test("summarizeStages orders stages slowest first", () => {
  const stages = summarizeStages(runs);
  assert.deepStrictEqual(stages.map((s) => s.stage), ["rerank", "guardrail"]);
});

test("summarizeStages costs a stage from its mean tokens, not its median", () => {
  // Cost per question is additive, so the mean is the right aggregator:
  // guardrail mean input is (100+200+300)/3 = 200, mean output is 1.
  const guardrail = summarizeStages(runs).find((s) => s.stage === "guardrail");
  assert.strictEqual(guardrail.meanInputTokens, 200);
  assert.strictEqual(guardrail.meanOutputTokens, 1);
  assert.ok(Math.abs(guardrail.costUsd - costUsd({ inputTokens: 200, outputTokens: 1 })) < 1e-12);
});

test("summarizeStages skips a stage that did not run in a given sample", () => {
  const mixed = [
    { wallMs: 10, stageTotals: { condense: 5 }, tokenTotals: {} },
    { wallMs: 10, stageTotals: {}, tokenTotals: {} },
  ];
  const condense = summarizeStages(mixed).find((s) => s.stage === "condense");
  assert.strictEqual(condense.n, 1, "only the run that had the stage should count");
  assert.strictEqual(condense.medianMs, 5);
});

test("summarizeWall reports the end-to-end numbers and the total cost", () => {
  const wall = summarizeWall(runs);
  assert.strictEqual(wall.n, 3);
  assert.strictEqual(wall.medianMs, 200);
  assert.strictEqual(wall.p95Ms, 300);
  // Total cost is the sum of the per-stage costs.
  const stageSum = summarizeStages(runs).reduce((a, s) => a + s.costUsd, 0);
  assert.ok(Math.abs(wall.costUsd - stageSum) < 1e-12);
});

test("summarizeWall reports the summed stage time so overlap is visible", () => {
  const wall = summarizeWall(runs);
  // Run 2 sums to 90ms of stage time against a 200ms wall clock.
  assert.strictEqual(wall.medianSummedStageMs, 90);
});
