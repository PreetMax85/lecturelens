// Latency and cost arithmetic for eval/perf.js.
//
// Prices are Gemini's published paid rates for gemini-3.1-flash-lite, checked
// on 2026-09-16: $0.25 per million input tokens and $1.50 per million output
// tokens. Actual spend on the free tier is zero; these turn measured token
// counts into what a question would cost if this ran on the paid tier.
const PRICE_PER_MTOK = { input: 0.25, output: 1.5 };
const PRICE_CHECKED_ON = "2026-09-16";

function median(values) {
  return percentile(values, 50);
}

// Nearest-rank percentile. On a 30-sample run p95 is the second-slowest
// observation, which is a coarse estimate, so perf.js says how many samples
// are behind it rather than presenting it as a smooth number.
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (p === 50) {
    const mid = sorted.length / 2;
    return sorted.length % 2
      ? sorted[Math.floor(mid)]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

function costUsd(tokens) {
  if (!tokens) return 0;
  const { inputTokens = 0, outputTokens = 0 } = tokens;
  return (
    (inputTokens / 1e6) * PRICE_PER_MTOK.input +
    (outputTokens / 1e6) * PRICE_PER_MTOK.output
  );
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

// One row per stage. Latency uses the median because it describes a typical
// wait; cost uses the mean because cost per question is additive and a median
// of per-run costs would not sum to the total.
function summarizeStages(runs) {
  const names = new Set();
  for (const run of runs) for (const name of Object.keys(run.stageTotals)) names.add(name);

  return [...names]
    .map((stage) => {
      const times = runs
        .filter((r) => r.stageTotals[stage] != null)
        .map((r) => r.stageTotals[stage]);
      // A stage that made no LLM call contributes zero tokens, which is a real
      // zero rather than a missing measurement, so every run counts here.
      const inputs = runs.map((r) => r.tokenTotals[stage]?.inputTokens ?? 0);
      const outputs = runs.map((r) => r.tokenTotals[stage]?.outputTokens ?? 0);
      const meanInputTokens = mean(inputs);
      const meanOutputTokens = mean(outputs);

      return {
        stage,
        n: times.length,
        medianMs: median(times),
        p95Ms: percentile(times, 95),
        meanInputTokens,
        meanOutputTokens,
        costUsd: costUsd({ inputTokens: meanInputTokens, outputTokens: meanOutputTokens }),
      };
    })
    .sort((a, b) => b.medianMs - a.medianMs);
}

function summarizeWall(runs) {
  const walls = runs.map((r) => r.wallMs);
  const summed = runs.map((r) => Object.values(r.stageTotals).reduce((a, b) => a + b, 0));
  return {
    n: runs.length,
    medianMs: median(walls),
    p95Ms: percentile(walls, 95),
    medianSummedStageMs: median(summed),
    costUsd: summarizeStages(runs).reduce((a, s) => a + s.costUsd, 0),
  };
}

module.exports = {
  median,
  percentile,
  costUsd,
  summarizeStages,
  summarizeWall,
  PRICE_PER_MTOK,
  PRICE_CHECKED_ON,
};
