// Speed and cost per pipeline stage for LectureLens.
//
// Usage: node eval/perf.js [--repeats N] [--questions N] [--dry-run]
//
// Asks a fixed sample of labeled questions through the same path the server
// takes, checkGuardrail() then answerQuestion(), and records how long each
// stage took and how many tokens it spent. Writes eval/perf.json and
// eval/perf.md.
//
// Why this cannot reuse the retrieval eval's cache: a cached response returns
// in microseconds, so timing a cached run measures nothing. Every call here is
// a real one. That makes this the only script in the repo whose committed
// output is measured data rather than something reproducible offline, and
// re-running it spends quota.
//
// The free tier allows about 30 requests a minute, and a single-turn question
// makes 4 calls. Runs are therefore spaced apart, but nothing sleeps *inside* a
// run, since a pause in the middle of the pipeline would corrupt the very thing
// being measured. A run that hits a 429 is flagged and left out of the
// published numbers instead of quietly becoming a slow sample.
//
// --dry-run   print the sample, the call count and the estimated wall time,
//             then exit without calling the API.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { checkGuardrail } = require("../src/guardrail");
const { answerQuestion } = require("../src/answer");
const { embedText } = require("../src/local-embed");
const { generate, MODEL } = require("../src/gemini");
const { createTrace } = require("../src/trace");
const {
  summarizeStages,
  summarizeWall,
  median,
  PRICE_PER_MTOK,
  PRICE_CHECKED_ON,
} = require("./perf-metrics");

// A fixed, hand-picked spread: eight single-turn questions across both authors
// and two follow-ups so the condensation stage is measured too. The questions
// the course does not cover (n01-n05) are left out because their answers are
// short refusals, which would understate the cost of a question that is
// actually answered.
const SAMPLE_IDS = ["c01", "c05", "c09", "c13", "p02", "p07", "p13", "p19", "m01", "m05"];
const REPEATS = 3;
const PAUSE_BETWEEN_RUNS_MS = Number(process.env.PERF_PAUSE_MS || 6000);
const MAX_ATTEMPTS = 4;

const OUT_JSON = path.join(__dirname, "perf.json");
const OUT_MD = path.join(__dirname, "perf.md");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real calls, no cache, with retries that record whether they happened. The
// pipeline swallows a failed stage and falls back, so without this a 429 would
// show up as a suspiciously fast stage rather than an error.
function createPerfLlm() {
  let retried = null;
  let calls = 0;

  async function llm(prompt, opts = {}) {
    for (let attempt = 1; ; attempt++) {
      try {
        calls++;
        return await generate(prompt, opts);
      } catch (err) {
        const status = Number((err.message.match(/failed: (\d{3})/) || [])[1]);
        const network = err instanceof TypeError && err.message === "fetch failed";
        const retryable = status === 429 || status >= 500 || network;
        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
        // Any retry sleeps in the middle of the pipeline, so this run's timing
        // is meaningless regardless of what caused it. Record why, and let the
        // caller drop the run rather than publish a stall as latency.
        retried = network ? "network error" : `HTTP ${status}`;
        const backoff = 3000 * 2 ** attempt;
        console.warn(`    [llm] ${retried}, retrying in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
  }

  return {
    llm,
    startRun: () => {
      retried = null;
      calls = 0;
    },
    runStats: () => ({ retried, calls }),
  };
}

// Runs are spaced apart to respect the free-tier rate limit, which is long
// enough for the keep-alive socket to lapse. Without this the first LLM call of
// every run re-pays DNS and TLS, and that cost lands on whichever stage happens
// to go first (the guardrail) rather than on the stage that caused it. A plain
// GET to the API host is not a model call, so it costs no quota.
async function warmConnection() {
  await fetch("https://generativelanguage.googleapis.com/", { method: "GET" }).catch(() => {});
}

async function measureRun(question, perf) {
  await warmConnection();
  const trace = createTrace();
  perf.startRun();

  const history = question.history || [];
  const allowed = await checkGuardrail(question.question, history, { llm: perf.llm, trace });
  // The guardrail should allow every labeled question. If it ever rejects one
  // the run is not comparable to the others, so it is recorded and skipped.
  const result = allowed
    ? await answerQuestion(question.question, history, { llm: perf.llm, trace })
    : null;

  const { retried, calls } = perf.runStats();
  return {
    id: question.id,
    multiTurn: history.length > 0,
    allowed,
    wallMs: trace.wallMs(),
    stageTotals: trace.stageTotals(),
    tokenTotals: trace.tokenTotals(),
    answerChars: result ? result.answer.length : 0,
    citations: result ? result.citationCheck.total : 0,
    calls,
    retried,
  };
}

function fmtMs(ms) {
  if (ms == null) return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

const fmtUsd = (usd) => `$${usd.toFixed(6)}`;

const STAGE_LABELS = {
  guardrail: "Guardrail (LLM)",
  condense: "Condensation (LLM)",
  "embed-query": "Embed the question (local)",
  hyde: "HyDE passage (LLM)",
  "embed-hyde": "Embed the HyDE passage (local)",
  search: "Vector search (Qdrant, x2)",
  rerank: "Rerank (LLM)",
  answer: "Answer generation (LLM)",
  "verify-citations": "Verify citations (local)",
};

function renderMarkdown({ runs, usable, stages, wall, modelLoadMs, connectionWarmupMs, startedAt }) {
  const lines = [];
  const singleTurn = usable.filter((r) => !r.multiTurn);
  const multiTurn = usable.filter((r) => r.multiTurn);
  const excluded = runs.length - usable.length;

  lines.push(
    `Model: \`${MODEL}\`. Measured on ${startedAt.slice(0, 10)} from ${usable.length} runs ` +
      `(${SAMPLE_IDS.length} questions x ${REPEATS} repeats), against the live Qdrant index.`
  );
  lines.push("");
  lines.push(
    "Unlike the retrieval tables, these numbers cannot be replayed from the committed " +
      "cache: a cached response returns in microseconds, so every call behind this table " +
      "was a real one. Re-running `npm run perf` spends quota and will produce slightly " +
      "different times."
  );
  lines.push("");

  lines.push("**Per stage**");
  lines.push("");
  lines.push("| Stage | Runs | Median | p95 | Mean input tokens | Mean output tokens | Cost per question |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const s of stages) {
    const label = STAGE_LABELS[s.stage] || s.stage;
    const tokens = s.meanInputTokens || s.meanOutputTokens;
    lines.push(
      `| ${label} | ${s.n} | ${fmtMs(s.medianMs)} | ${fmtMs(s.p95Ms)} | ` +
        `${tokens ? Math.round(s.meanInputTokens) : "-"} | ${tokens ? Math.round(s.meanOutputTokens) : "-"} | ` +
        `${tokens ? fmtUsd(s.costUsd) : "free"} |`
    );
  }
  lines.push("");

  lines.push("**End to end**");
  lines.push("");
  lines.push("| Measure | Value |");
  lines.push("|---|---|");
  lines.push(`| Median wait for an answer | ${fmtMs(wall.medianMs)} |`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push(`| p95 wait (slowest of ${plural(wall.n, "run")} is ${fmtMs(Math.max(...usable.map((r) => r.wallMs)))}) | ${fmtMs(wall.p95Ms)} |`);
  if (singleTurn.length) {
    lines.push(`| Median wait, single-turn questions (${plural(singleTurn.length, "run")}) | ${fmtMs(median(singleTurn.map((r) => r.wallMs)))} |`);
  }
  if (multiTurn.length) {
    lines.push(`| Median wait, follow-up questions (${plural(multiTurn.length, "run")}) | ${fmtMs(median(multiTurn.map((r) => r.wallMs)))} |`);
  }
  lines.push(`| Median summed stage time | ${fmtMs(wall.medianSummedStageMs)} |`);
  lines.push(`| Cost per question | ${fmtUsd(wall.costUsd)} |`);
  lines.push(`| Questions per US dollar | ${Math.round(1 / wall.costUsd).toLocaleString("en-US")} |`);
  lines.push("");

  lines.push(
    "The summed stage time is larger than the wall clock because stages overlap: the " +
      "question embed and the HyDE call run concurrently, and so do the two vector searches."
  );
  lines.push("");
  lines.push(
    `Cost uses Gemini's published paid rates for \`${MODEL}\`, $${PRICE_PER_MTOK.input.toFixed(2)} per ` +
      `million input tokens and $${PRICE_PER_MTOK.output.toFixed(2)} per million output tokens, checked on ` +
      `${PRICE_CHECKED_ON}. Actual spend is zero on the free tier.`
  );
  lines.push("");
  const p95Rank = Math.max(1, Math.ceil(0.95 * wall.n));
  const fromSlowest = wall.n - p95Rank + 1;
  lines.push(
    `p95 here is the nearest-rank value over ${wall.n} runs, which makes it the ` +
      `${fromSlowest === 1 ? "slowest" : `${fromSlowest}${fromSlowest === 2 ? "nd" : "th"} slowest`} ` +
      "observation rather than a smooth estimate. Treat it as an indication, not a guarantee."
  );
  lines.push("");
  lines.push(
    `These times are warm. The embedding model is loaded before any measurement starts ` +
      `(${fmtMs(modelLoadMs)} here) and one throwaway API call establishes the connection ` +
      `(${fmtMs(connectionWarmupMs)}, most of it DNS and TLS). A cold start on a sleeping ` +
      "free-tier server pays both of those again, and pays them on the first stage that runs."
  );

  if (excluded) {
    lines.push("");
    lines.push(
      `${excluded} of ${runs.length} runs were excluded: ` +
        runs
          .filter((r) => r.retried || !r.allowed)
          .map((r) => `${r.id} (${r.retried ? `retried after ${r.retried}, so it slept mid-pipeline` : "rejected by the guardrail"})`)
          .join(", ") +
        "."
    );
  }

  lines.push("");
  lines.push("**Per question** (median wall clock over the repeats)");
  lines.push("");
  lines.push("| Question | Turns | Median | Calls | Answer chars | Citations |");
  lines.push("|---|---|---|---|---|---|");
  for (const id of SAMPLE_IDS) {
    const forId = usable.filter((r) => r.id === id);
    if (!forId.length) continue;
    lines.push(
      `| ${id} | ${forId[0].multiTurn ? "follow-up" : "single"} | ` +
        `${fmtMs(median(forId.map((r) => r.wallMs)))} | ${forId[0].calls} | ` +
        `${Math.round(median(forId.map((r) => r.answerChars)))} | ${median(forId.map((r) => r.citations))} |`
    );
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
  };
  const repeats = flag("--repeats", REPEATS);
  const limit = flag("--questions", SAMPLE_IDS.length);

  const questions = require("./questions.json");
  const byId = new Map(questions.map((q) => [q.id, q]));
  const sample = SAMPLE_IDS.slice(0, limit).map((id) => {
    const q = byId.get(id);
    if (!q) throw new Error(`Question "${id}" is not in eval/questions.json`);
    return q;
  });

  // 4 calls for a single-turn question, 5 for a follow-up (condensation).
  const plannedCalls = sample.reduce((a, q) => a + (q.history?.length ? 5 : 4), 0) * repeats;
  const runCount = sample.length * repeats;
  console.log(
    `${sample.length} questions x ${repeats} repeats = ${runCount} runs, ` +
      `about ${plannedCalls} API calls, roughly ` +
      `${Math.ceil((runCount * (PAUSE_BETWEEN_RUNS_MS + 7000)) / 60000)} minutes.`
  );
  console.log(`Sample: ${sample.map((q) => q.id).join(", ")}`);
  if (dryRun) {
    console.log("Dry run, nothing called.");
    return;
  }

  // Warm the embedder first so no measured run pays the model load.
  const loadStart = process.hrtime.bigint();
  await embedText("warmup");
  const modelLoadMs = Number(process.hrtime.bigint() - loadStart) / 1e6;
  console.log(`Embedding model ready in ${fmtMs(modelLoadMs)}.`);

  const perf = createPerfLlm();

  // One throwaway call so DNS, TCP and TLS to the API are already established.
  // Without it the first measured run charges all of that to the guardrail,
  // which is simply the stage that happens to go first.
  const warmStart = process.hrtime.bigint();
  await perf.llm("Reply with the single word: ok", { temperature: 0 });
  const connectionWarmupMs = Number(process.hrtime.bigint() - warmStart) / 1e6;
  console.log(`First API call (DNS, TLS and all) took ${fmtMs(connectionWarmupMs)}, not measured.\n`);
  const startedAt = new Date().toISOString();
  const runs = [];

  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const question of sample) {
      const run = await measureRun(question, perf);
      runs.push({ ...run, repeat });
      const flags = [run.retried ? `RETRIED (${run.retried})` : null, run.allowed ? null : "REJECTED"]
        .filter(Boolean)
        .join(" ");
      console.log(
        `  repeat ${repeat} ${run.id.padEnd(4)} ${fmtMs(run.wallMs).padStart(8)} ` +
          `${run.calls} calls ${flags}`
      );
      if (runs.length < runCount) await sleep(PAUSE_BETWEEN_RUNS_MS);
    }
  }

  const usable = runs.filter((r) => r.allowed && !r.retried);
  if (!usable.length) throw new Error("Every run retried or was rejected; refusing to write results.");

  const stages = summarizeStages(usable);
  const wall = summarizeWall(usable);

  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      { model: MODEL, startedAt, repeats, sampleIds: SAMPLE_IDS.slice(0, limit), modelLoadMs, connectionWarmupMs, prices: PRICE_PER_MTOK, priceCheckedOn: PRICE_CHECKED_ON, stages, wall, runs },
      null,
      2
    ) + "\n"
  );
  const markdown = renderMarkdown({ runs, usable, stages, wall, modelLoadMs, connectionWarmupMs, startedAt });
  fs.writeFileSync(OUT_MD, markdown);

  console.log(`\n${markdown}`);
  console.log(`Wrote ${path.relative(process.cwd(), OUT_JSON)} and ${path.relative(process.cwd(), OUT_MD)}.`);
  if (usable.length < runs.length) {
    console.log(`Note: ${runs.length - usable.length} of ${runs.length} runs were excluded.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
