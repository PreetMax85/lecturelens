// Rerank bake-off: the production Gemini reranker against local
// cross-encoders, on the same candidate pools.
//
// Usage: node eval/rerank-bakeoff.js
//
// Measurement only. Nothing here changes src/, and it makes no Gemini calls:
// the LLM is the cache-only wrapper, so the HyDE passages and the LLM rerank
// orders come from eval/cache/llm.json and a cache miss aborts the run. It
// needs the live Qdrant index, like eval/run.js.
//
// For each single-turn question, retrieve() builds the candidate pool twice,
// once without HyDE and once with HyDE draw 1 (the pools behind the "+ Rerank
// (no HyDE)" and production rows of eval/results.md). Each cross-encoder then
// scores every candidate in the pool, from two inputs:
//
//   text       the chunk text alone.
//   header     "[module | lesson | timestamp] " before the chunk text, the same
//              header the LLM reranker is shown, so lesson titles are not an
//              advantage only the LLM gets.
//
// Each scored list is then cut two ways:
//
//   top 5      the production FINAL_K. The LLM reranker drops excerpts it
//              judges irrelevant and returns about 3 on average, so this arm
//              gets a longer list and hit@k favours it.
//   LLM's k    cut to however many results the LLM returned for the same
//              question, so both lists are the same length. No threshold is
//              tuned, so nothing is fitted to these questions.
//
// Before scoring, the no-rerank and LLM rows are checked rank for rank against
// eval/results.json, so the bake-off provably uses the same pools and orders
// as the published eval.
//
// Latency covers only the rerank step: tokenizing and scoring one pool, timed
// after a warm-up, over TIMING_REPEATS passes of every pool. The LLM row's
// latency and cost come from eval/perf.json instead of being re-measured.
//
// Writes eval/rerank-bakeoff.json and eval/rerank-bakeoff.md. It is not part
// of the CI drift check: latency changes on every run, and cross-encoder float
// scores are only known to be bit-identical across runs on one machine.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { AutoTokenizer, AutoModelForSequenceClassification } = require("@xenova/transformers");

const { retrieve } = require("../src/answer");
const { createCachedLlm } = require("./llm-cache");
const { scoreQuestion, aggregate } = require("./metrics");
const { median, percentile } = require("./perf-metrics");
const { orderByScores, cutToK } = require("./rerank-select");

const FINAL_K = 5;
const TIMING_REPEATS = 3;

// fp32 weights on purpose: the quantized exports of these models scored the
// same pair differently depending on what else was in the batch.
const MODELS = [
  { id: "minilm", name: "Xenova/ms-marco-MiniLM-L-6-v2", label: "MiniLM-L-6 (ms-marco)" },
  { id: "mxbai", name: "mixedbread-ai/mxbai-rerank-xsmall-v1", label: "mxbai-rerank-xsmall" },
];

// The LLM reranker's listing header (src/answer.js), without its 300-character
// cut on the text.
const INPUTS = [
  { id: "text", label: "text", format: (p) => p.text },
  { id: "header", label: "header + text", format: (p) => `[${p.module} | ${p.lesson} | ${p.timestamp}] ${p.text}` },
];

const RERANKERS = MODELS.flatMap((model) =>
  INPUTS.map((input) => ({ id: `${model.id}-${input.id}`, model, input, label: `${model.label}, ${input.label}` }))
);

const POOLS = [
  { id: "no-hyde", label: "Without HyDE", hyde: false, vectorRow: "vector", llmRow: "rerank" },
  { id: "hyde", label: "With HyDE, draw 1 (production pool)", hyde: true, vectorRow: "hyde", llmRow: "hyde+rerank" },
];

async function loadCrossEncoder(model) {
  const started = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained(model.name);
  const network = await AutoModelForSequenceClassification.from_pretrained(model.name, { quantized: false });
  const loadMs = performance.now() - started;

  // One relevance logit per (query, passage) pair, all pairs in one batch.
  async function score(query, candidates, format) {
    const texts = candidates.map((c) => format(c.payload));
    const inputs = tokenizer(texts.map(() => query), { text_pair: texts, padding: true, truncation: true });
    const { logits } = await network(inputs);
    return Array.from(logits.data);
  }
  return { score, loadMs };
}

const ids = (results) => results.map((r) => r.id);
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

// Retrieval runs silently fall back on a failed stage. With a cache-only llm a
// miss is a failure, so any fallback means the pools are not the published ones.
async function strictRetrieve(question, opts) {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const out = await retrieve(question, [], opts);
    if (errors.length) throw new Error(`retrieve() fell back: ${errors.join("; ")}`);
    return out;
  } finally {
    console.error = original;
  }
}

function checkAgainstPublished(published, row, perQuestion) {
  const mismatched = Object.keys(perQuestion).filter((id) => published.configs[row].perQuestion[id].rank !== perQuestion[id].rank);
  if (mismatched.length) {
    throw new Error(`Ranks differ from eval/results.json row "${row}" on ${mismatched.join(", ")}`);
  }
}

// Per-question wins and losses of `a` against `b`, on hit@1 and on hit@k.
function headToHead(a, b) {
  const qs = Object.keys(a);
  const count = (hit) => ({
    wins: qs.filter((id) => hit(a[id]) && !hit(b[id])),
    losses: qs.filter((id) => !hit(a[id]) && hit(b[id])),
  });
  return { hit1: count((s) => s.rank === 1), hitK: count((s) => s.rank != null) };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);

function toMarkdown(results) {
  const lines = [
    `Candidate pools from the ${results.questions} single-turn questions in eval/questions.json, ` +
      "the same pools and LLM rerank orders as eval/results.md (checked rank for rank). " +
      "0 Gemini calls: the LLM rows replay eval/cache/llm.json.",
    "",
    `One question moves a hit rate by ${(100 / results.questions).toFixed(1)} points, so gaps of one or two ` +
      "questions are noise. The head-to-head table lists the questions behind each gap.",
    "",
    "Arms:",
    "",
    "- **LLM's k**: the cross-encoder list cut to the number of results the LLM reranker returned for that " +
      "question. Same list length as the LLM row, so this is the like-for-like comparison.",
    "- **top 5**: the production FINAL_K. The LLM reranker drops excerpts it judges irrelevant, so this arm " +
      "returns more results than the LLM row and hit@k favours it. Hit@1 does not depend on k.",
    "- **text** / **header + text**: what the cross-encoder scores. The LLM reranker sees " +
      "`[module | lesson | timestamp]` and the first 300 characters of each chunk, so the header input gives the " +
      "cross-encoder the same lesson titles (with the full chunk text).",
    "  The header input was added after a first run scored text only, to rule out the lesson titles as the " +
      "reason the LLM wins. It is an input choice, not a tuned parameter.",
    "",
  ];

  const header =
    "| Reranker | Avg k | Hit@1 | Hit@k | MRR@k | Pool recall@10 | Rerank latency, median / p95 | Cost per question |\n" +
    "|---|---|---|---|---|---|---|---|";
  for (const pool of results.pools) {
    lines.push(`**${pool.label}**`, "", header);
    for (const arm of pool.arms) {
      const m = arm.metrics;
      lines.push(
        `| ${arm.label} | ${m.avgReturned.toFixed(1)} | ${pct(m.hit1)} | ${pct(m.hit5)} (${Math.round(m.hit5 * m.n)}/${m.n}) | ` +
          `${m.mrr5.toFixed(3)} | ${pct(m.recall10)} | ${arm.latency} | ${arm.cost} |`
      );
    }
    lines.push("", `Head-to-head against the LLM reranker (questions a cross-encoder arm gets that the LLM does not, and the reverse):`, "");
    lines.push("| Arm | Hit@1 wins | Hit@1 losses | Hit@k wins | Hit@k losses |\n|---|---|---|---|---|");
    const list = (qs) => (qs.length ? `${qs.length} (${qs.join(", ")})` : "0");
    for (const h of pool.headToHead) {
      lines.push(`| ${h.label} | ${list(h.hit1.wins)} | ${list(h.hit1.losses)} | ${list(h.hitK.wins)} | ${list(h.hitK.losses)} |`);
    }
    lines.push("");
  }

  const t = results.timing;
  lines.push(
    "**Latency method**",
    "",
    `Cross-encoder rows: fp32 weights on CPU, one batch per pool, timed after a warm-up over ${t.repeats} passes of ` +
      `every pool (${t.samplesPerReranker} samples per reranker and input). Machine: ${t.machine}. These are laptop numbers, not ` +
      "the deployed host, and they exclude the one-off model load (" +
      MODELS.map((m) => `${m.label} ${ms(t.loadMs[m.id])}`).join(", ") +
      " on this run, from the local cache). Cost is zero API spend; the cost is CPU time and memory on the server.",
    "",
    `LLM rows: the rerank stage from eval/perf.json (${results.llmPerf.n} real production runs, ${results.llmPerf.model}, ` +
      "network round trip included), not re-measured here. Cost at the paid rates listed in eval/perf.md.",
    ""
  );
  return lines.join("\n");
}

async function main() {
  const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
  const single = questions.filter((q) => !q.history && q.expected.length);
  const published = JSON.parse(fs.readFileSync(path.join(__dirname, "results.json"), "utf8"));
  const perf = JSON.parse(fs.readFileSync(path.join(__dirname, "perf.json"), "utf8"));
  const llmPerf = perf.stages.find((s) => s.stage === "rerank");
  const { llm, stats } = createCachedLlm({ cacheOnly: true });

  const encoders = {};
  const loadMs = {};
  for (const model of MODELS) {
    encoders[model.id] = await loadCrossEncoder(model);
    loadMs[model.id] = encoders[model.id].loadMs;
  }

  // Build every pool first (Qdrant plus cached Gemini), so the timing loop
  // below measures only the cross-encoders.
  const pools = [];
  for (const pool of POOLS) {
    process.stdout.write(`${pool.label.padEnd(40)} `);
    const perQuestion = [];
    for (const q of single) {
      const plain = await strictRetrieve(q.question, { hyde: pool.hyde, rerank: false, llm });
      const reranked = await strictRetrieve(q.question, { hyde: pool.hyde, rerank: true, llm });
      if (!sameIds(ids(plain.candidates), ids(reranked.candidates))) {
        throw new Error(`${q.id}: the two retrieve() runs built different candidate pools`);
      }
      perQuestion.push({ q, query: plain.standaloneQuery, candidates: plain.candidates, vector: plain, llm: reranked });
      process.stdout.write(".");
    }
    process.stdout.write("\n");
    pools.push({ pool, perQuestion });
  }

  // Scores are taken on the first pass; later passes only add timing samples.
  // Each pass also checks the scores are identical to the first.
  const timings = Object.fromEntries(RERANKERS.map((r) => [r.id, []]));
  const scores = {};
  for (const model of MODELS) {
    const { query, candidates } = pools[0].perQuestion[0];
    await encoders[model.id].score(query, candidates, INPUTS[0].format); // warm-up, not timed
  }
  for (let pass = 0; pass < TIMING_REPEATS; pass++) {
    for (const r of RERANKERS) {
      for (const { pool, perQuestion } of pools) {
        for (const { q, query, candidates } of perQuestion) {
          const started = performance.now();
          const s = await encoders[r.model.id].score(query, candidates, r.input.format);
          timings[r.id].push(performance.now() - started);
          const key = `${r.id}/${pool.id}/${q.id}`;
          if (!scores[key]) scores[key] = s;
          else if (!s.every((x, i) => Object.is(x, scores[key][i]))) throw new Error(`${key}: scores changed between passes`);
        }
      }
    }
  }

  const results = {
    questions: single.length,
    models: MODELS,
    inputs: INPUTS.map(({ id, label }) => ({ id, label })),
    llmPerf: { n: llmPerf.n, model: perf.model, medianMs: llmPerf.medianMs, p95Ms: llmPerf.p95Ms, costUsd: llmPerf.costUsd },
    timing: {
      repeats: TIMING_REPEATS,
      samplesPerReranker: timings[RERANKERS[0].id].length,
      machine: `${os.cpus()[0].model.trim()}, ${os.cpus().length} threads, Node ${process.version}`,
      loadMs,
      perReranker: Object.fromEntries(RERANKERS.map((r) => [r.id, { medianMs: median(timings[r.id]), p95Ms: percentile(timings[r.id], 95) }])),
    },
    pools: [],
  };

  for (const { pool, perQuestion } of pools) {
    const rows = { vector: {}, llm: {} };
    const perArm = {};
    const detail = {};
    for (const { q, query, candidates, vector, llm: reranked } of perQuestion) {
      rows.vector[q.id] = scoreQuestion(q, vector);
      rows.llm[q.id] = scoreQuestion(q, reranked);
      detail[q.id] = { query, candidates: ids(candidates), llm: ids(reranked.results), scores: {} };
      for (const r of RERANKERS) {
        const s = scores[`${r.id}/${pool.id}/${q.id}`];
        const ordered = orderByScores(candidates, s);
        detail[q.id].scores[r.id] = s;
        const arms = { top5: cutToK(ordered, FINAL_K), llmK: cutToK(ordered, reranked.results.length) };
        for (const [arm, list] of Object.entries(arms)) {
          const key = `${r.id}/${arm}`;
          (perArm[key] ||= {})[q.id] = scoreQuestion(q, { candidates, results: list });
        }
      }
    }
    checkAgainstPublished(published, pool.vectorRow, rows.vector);
    checkAgainstPublished(published, pool.llmRow, rows.llm);

    const llmLatency = `${ms(llmPerf.medianMs)} / ${ms(llmPerf.p95Ms)}`;
    const localLatency = (id) => `${ms(results.timing.perReranker[id].medianMs)} / ${ms(results.timing.perReranker[id].p95Ms)}`;
    const arms = [
      { id: "none", label: "No rerank (vector order, top 5)", perQuestion: rows.vector, latency: "none", cost: "$0" },
      { id: "llm", label: `LLM rerank (${perf.model}, production)`, perQuestion: rows.llm, latency: llmLatency, cost: `$${llmPerf.costUsd.toFixed(6)}` },
    ];
    for (const r of RERANKERS) {
      for (const [arm, label] of [["llmK", "LLM's k"], ["top5", "top 5"]]) {
        const id = `${r.id}/${arm}`;
        arms.push({ id, label: `${r.label}, ${label}`, local: true, perQuestion: perArm[id], latency: localLatency(r.id), cost: "$0 (local CPU)" });
      }
    }
    results.pools.push({
      id: pool.id,
      label: pool.label,
      arms: arms.map((a) => ({ ...a, metrics: aggregate(Object.values(a.perQuestion)) })),
      headToHead: arms.filter((a) => a.local).map((a) => ({ id: a.id, label: a.label, ...headToHead(a.perQuestion, rows.llm) })),
      perQuestion: detail,
    });
  }

  if (stats.calls || stats.failures.length) {
    throw new Error(`Expected 0 Gemini calls and 0 cache misses, got ${stats.calls} calls and ${stats.failures.length} misses`);
  }
  console.log(`LLM: 0 API calls, ${stats.hits} cache hits.`);

  fs.writeFileSync(path.join(__dirname, "rerank-bakeoff.json"), JSON.stringify(results, null, 2) + "\n");
  const md = toMarkdown(results);
  fs.writeFileSync(path.join(__dirname, "rerank-bakeoff.md"), md);
  console.log("\n" + md);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
