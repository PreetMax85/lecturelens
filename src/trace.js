// Records how long each pipeline stage took and how many tokens it spent, so
// eval/perf.js can report per-stage latency and cost without the pipeline
// itself knowing anything about measurement.
//
// Stages can run concurrently (the query embed and the HyDE call do), so the
// per-stage times deliberately sum to more than wallMs(). Both are reported.
//
// The server passes no trace and gets NOOP_TRACE, which runs the work and
// keeps nothing.

function createTrace() {
  const startedAt = process.hrtime.bigint();
  const spans = [];
  const tokens = new Map();

  async function span(name, fn) {
    const begin = process.hrtime.bigint();
    try {
      return await fn();
    } finally {
      // Recorded in `finally` so a stage that throws still shows its cost.
      const ms = Number(process.hrtime.bigint() - begin) / 1e6;
      spans.push({ name, ms });
    }
  }

  // A call that reports no usage is left out rather than counted as zero, so a
  // missing usageMetadata can never be mistaken for a free call.
  function usage(name, reported) {
    if (!reported) return;
    const { inputTokens = 0, outputTokens = 0 } = reported;
    const running = tokens.get(name) || { inputTokens: 0, outputTokens: 0 };
    running.inputTokens += inputTokens;
    running.outputTokens += outputTokens;
    tokens.set(name, running);
  }

  return {
    span,
    usage,
    onUsage: (name) => (reported) => usage(name, reported),
    spans: () => spans.map((s) => ({ ...s })),
    stageTotals: () =>
      spans.reduce((totals, s) => {
        totals[s.name] = (totals[s.name] || 0) + s.ms;
        return totals;
      }, {}),
    tokenTotals: () => Object.fromEntries([...tokens].map(([k, v]) => [k, { ...v }])),
    wallMs: () => Number(process.hrtime.bigint() - startedAt) / 1e6,
  };
}

const NOOP_TRACE = {
  span: (_name, fn) => fn(),
  usage: () => {},
  onUsage: () => () => {},
  spans: () => [],
  stageTotals: () => ({}),
  tokenTotals: () => ({}),
  wallMs: () => 0,
};

module.exports = { createTrace, NOOP_TRACE };
