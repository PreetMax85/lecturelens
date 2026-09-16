// Retrieval ablation for LectureLens.
//
// Usage: node eval/run.js [--cache-only | --dry-run]
//
// Runs every labeled question in eval/questions.json through retrieve()
// from src/answer.js (the production code path) against the live Qdrant
// index, with pipeline stages switched on one at a time, and reports hit@k
// and MRR per configuration. Then generates full production answers and
// measures how many of their citations verify against the retrieved
// excerpts. Questions labeled with no expected windows are ones the course
// does not cover: they skip the retrieval tables, and their answers are
// checked for saying so. Writes eval/results.json and eval/results.md.
//
// HyDE runs at temperature 0.4, so the single-turn HyDE rows are also re-run
// for HYDE_DRAWS independent draws and reported as min/mean/max.
//
// --cache-only  fail on any Gemini cache miss instead of calling the API,
//               so the committed numbers can be reproduced with no quota.
// --dry-run     print how many HyDE draws are missing from the cache and an
//               upper bound on the API calls they cost, then exit.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { retrieve, answerQuestion, hydeRequest } = require("../src/answer");
const { extractCitations } = require("../src/citations");
const { scrollPayloads, COLLECTION } = require("../src/qdrant");
const { MODEL } = require("../src/gemini");
const { createCachedLlm } = require("./llm-cache");
const { overlapsWindow, scoreQuestion, aggregate, summarizeDraws, saysNotCovered } = require("./metrics");
const { formatTimestamp } = require("../src/chunker");

const EXPECTED_POINTS = 1955;

const SINGLE_TURN_CONFIGS = [
  { id: "vector", label: "Vector search only", opts: { hyde: false, rerank: false } },
  { id: "hyde", label: "+ HyDE", opts: { hyde: true, rerank: false } },
  { id: "rerank", label: "+ Rerank (no HyDE)", opts: { hyde: false, rerank: true } },
  { id: "hyde+rerank", label: "+ HyDE + Rerank (production)", opts: { hyde: true, rerank: true } },
];

// Draw 1 (HyDE sample 0) is the one in the tables above; draws 2..HYDE_DRAWS
// use samples 1..HYDE_DRAWS-1.
const HYDE_DRAWS = 4;
const HYDE_VARIANCE_CONFIGS = ["hyde", "hyde+rerank"];

const lastUserTurn = (q) => [...q.history].reverse().find((h) => h.role === "user").content;

// Multi-turn rows all run HyDE + rerank; only the handling of history varies.
const MULTI_TURN_CONFIGS = [
  { id: "followup-only", label: "Follow-up alone (no condensation)", query: (q) => q.question, condense: false },
  { id: "concat", label: "Previous turn + follow-up, concatenated", query: (q) => `${lastUserTurn(q)} ${q.question}`, condense: false },
  { id: "condense", label: "LLM condensation (production)", query: (q) => q.question, condense: true },
];

// [candidate, baseline] pairs reported as per-question wins/losses on hit@5.
const COMPARISONS = [
  ["hyde", "vector"],
  ["rerank", "vector"],
  ["hyde+rerank", "hyde"],
  ["hyde+rerank", "rerank"],
  ["concat", "followup-only"],
  ["condense", "concat"],
  ["condense", "followup-only"],
];

function describe(r) {
  const p = r.payload;
  return `${p.module} | ${p.lessonFolder} | ${formatTimestamp(p.start)}-${formatTimestamp(p.end)}`;
}

async function preflight(questions) {
  const points = await scrollPayloads();
  if (points.length !== EXPECTED_POINTS) {
    throw new Error(
      `Collection "${COLLECTION}" has ${points.length} points, expected ${EXPECTED_POINTS}. ` +
        "Re-ingest (or update EXPECTED_POINTS if the corpus changed on purpose)."
    );
  }
  const bad = [];
  for (const q of questions) {
    for (const exp of q.expected) {
      if (!points.some((p) => overlapsWindow(p.payload, exp))) {
        bad.push(`${q.id}: no indexed chunk overlaps ${exp.module} / ${exp.lesson} ${exp.start}-${exp.end}`);
      }
    }
  }
  if (bad.length) throw new Error(`Label validation failed:\n  ${bad.join("\n  ")}`);
  return points.length;
}

// Stage failures inside retrieve() are caught and silently fall back (by
// design, for production). API errors invalidate the run (see main); what
// remains are rerank responses that didn't parse, which production would
// hit too, so they are counted and reported rather than hidden.
async function withFallbackCount(fn) {
  const original = console.error;
  let fallbacks = 0;
  console.error = (...args) => {
    if (/^\[(hyde|rerank|condense)\]/.test(String(args[0]))) fallbacks++;
    original(...args);
  };
  try {
    return { value: await fn(), fallbacks };
  } finally {
    console.error = original;
  }
}

async function runConfig(config, questions, llm, queryOf, historyOf) {
  const perQuestion = {};
  let fallbacks = 0;
  for (const q of questions) {
    const { value, fallbacks: f } = await withFallbackCount(() =>
      retrieve(queryOf(q), historyOf(q), { ...config.opts, llm })
    );
    fallbacks += f;
    perQuestion[q.id] = {
      ...scoreQuestion(q, value),
      query: value.standaloneQuery,
      top5: value.results.map(describe),
    };
    process.stdout.write(perQuestion[q.id].rank != null ? "." : "x");
  }
  process.stdout.write("\n");
  return { perQuestion, fallbacks };
}

// Full production answers (condense + HyDE + rerank + generation). Also
// counts timestamps outside any parsed citation, since a citation written
// in a shape the parser doesn't recognise would otherwise go unchecked.
async function runCitationCheck(questions, llm, answers) {
  const perQuestion = {};
  process.stdout.write(`${"Production answers (citation check)".padEnd(42)} `);
  for (const q of questions) {
    const { answer, citationCheck } = await answerQuestion(q.question, q.history || [], { llm });
    answers[q.id] = answer;
    let rest = answer;
    // ranges of one compound citation share its text, so blank each distinct text
    for (const text of new Set(extractCitations(answer).map((c) => c.text))) rest = rest.replaceAll(text, "");
    perQuestion[q.id] = {
      ...citationCheck,
      strayTimestamps: (rest.match(/\b\d{1,2}:\d{2}\b/g) || []).length,
    };
    process.stdout.write(citationCheck.unverified.length ? "x" : ".");
  }
  process.stdout.write("\n");
  const all = Object.values(perQuestion);
  const sum = (f) => all.reduce((acc, r) => acc + f(r), 0);
  const byStatus = (status) => sum((r) => r.unverified.filter((u) => u.status === status).length);
  return {
    answers: all.length,
    citations: sum((r) => r.total),
    verified: sum((r) => r.verified),
    wrongTimestamp: byStatus("wrong_timestamp"),
    unknownSource: byStatus("unknown_source"),
    answersWithoutCitations: all.filter((r) => r.total === 0).length,
    strayTimestamps: sum((r) => r.strayTimestamps),
    perQuestion,
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;

function toMarkdown(results) {
  const row = (c) => {
    const m = c.metrics;
    const hits = Math.round(m.hit5 * m.n);
    return `| ${c.label} | ${m.n} | ${m.avgReturned.toFixed(1)} | ${pct(m.hit1)} | ${pct(m.hit5)} (${hits}/${m.n}) | ${m.mrr5.toFixed(3)} | ${pct(m.lessonHit5)} | ${pct(m.recall10)} |`;
  };
  const header =
    "| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |\n|---|---|---|---|---|---|---|---|";
  const single = SINGLE_TURN_CONFIGS.map((c) => row(results.configs[c.id]));
  const multi = MULTI_TURN_CONFIGS.map((c) => row(results.configs[c.id]));
  const spread = (s, f) => `${f(s.min)} / ${f(s.mean)} / ${f(s.max)}`;
  const mrr = (x) => x.toFixed(3);
  const variance = HYDE_VARIANCE_CONFIGS.map((id) => {
    const v = results.hydeVariance.configs[id];
    return `| ${v.label} | ${spread(v.hit1, pct)} | ${spread(v.hit5, pct)} | ${spread(v.mrr5, mrr)} | ${spread(v.recall10, pct)} | ${v.flips} of ${results.configs[id].metrics.n} (${v.flipped.join(", ")}) |`;
  });
  const hv = results.hydeVariance.configs[HYDE_VARIANCE_CONFIGS[0]];
  const comps = results.comparisons.map(
    (c) => `| ${results.configs[c.candidate].label} vs ${results.configs[c.baseline].label} | +${c.wins} | -${c.losses} |`
  );
  return [
    `Model: \`${results.model}\`. Index: ${results.points} chunks. ` +
      `Rerank responses that failed to parse (fell back to vector order): ${results.rerankParseFallbacks}.`,
    "",
    "`k` is the number of results the configuration actually returned, shown in " +
      "the Avg results column. It is 5 on the rows without rerank. The reranker " +
      "drops excerpts it judges irrelevant instead of padding the list, so on the " +
      "reranked rows it is at most 5 and usually fewer. A shorter list can only " +
      "lose hits, never gain them.",
    "",
    "**Single-turn questions**",
    "",
    header,
    ...single,
    "",
    `**HyDE variance** (single-turn, ${hv.draws} independent HyDE draws at temperature 0.4, min / mean / max; ` +
      "the table above is draw 1)",
    "",
    "| Configuration | Hit@1 | Hit@k | MRR@k | Pool recall@10 | Questions whose hit@k flips |\n|---|---|---|---|---|---|",
    ...variance,
    "",
    `Rerank responses that failed to parse in the extra draws: ${results.hydeVariance.fallbacks}.`,
    "",
    "**Multi-turn follow-ups** (all rows use HyDE + rerank)",
    "",
    header,
    ...multi,
    "",
    "**Citation accuracy** (full production answers, all questions)",
    "",
    `${results.citations.verified} of ${results.citations.citations} citations verified ` +
      `(${pct(results.citations.verified / Math.max(results.citations.citations, 1))}) across ${results.citations.answers} answers. ` +
      `Wrong timestamp: ${results.citations.wrongTimestamp}. Lesson not among the excerpts: ${results.citations.unknownSource}. ` +
      `Answers with no parseable citation: ${results.citations.answersWithoutCitations}. ` +
      `Timestamps outside a parseable citation: ${results.citations.strayTimestamps} ` +
      `(nonzero means some citation was written in a shape the parser does not recognise).`,
    "",
    "**Questions the course does not cover** (full production answers)",
    "",
    `${results.notCovered.filter((r) => r.saysNotCovered).length} of ${results.notCovered.length} answers said ` +
      "the course does not cover it (keyword check; the full answers are in results.json and are read by hand).",
    "",
    "| Question | Said not covered | Citations |\n|---|---|---|",
    ...results.notCovered.map(
      (r) => `| ${r.id}: ${r.question} | ${r.saysNotCovered ? "yes" : "no"} | ${results.citations.perQuestion[r.id].total} |`
    ),
    "",
    "**Per-question changes in hit@k**",
    "",
    "| Comparison | Newly hit | Newly missed |\n|---|---|---|",
    ...comps,
    "",
  ].join("\n");
}

async function main() {
  const cacheOnly = process.argv.includes("--cache-only");
  const questions = JSON.parse(fs.readFileSync(path.join(__dirname, "questions.json"), "utf8"));
  const notCovered = questions.filter((q) => !q.expected.length);
  const single = questions.filter((q) => !q.history && q.expected.length);
  const multi = questions.filter((q) => q.history && q.expected.length);

  const points = await preflight(questions);
  console.log(
    `Index OK: ${points} points. ${single.length} single-turn, ${multi.length} multi-turn, ` +
      `${notCovered.length} not-covered questions.`
  );

  const { llm, has, stats } = createCachedLlm({ cacheOnly });

  // A missing HyDE passage costs a HyDE call plus the production row's rerank.
  // When the passage is cached, the rerank prompt is known, so retrieve() runs
  // against a cache-only llm (local embedding and Qdrant, no Gemini) and a
  // cache miss marks the rerank as missing. Catches a run that died partway
  // through the production draws, after every passage was cached.
  if (process.argv.includes("--dry-run")) {
    const probe = createCachedLlm({ cacheOnly: true });
    let hydeMissing = 0;
    let rerankMissing = 0;
    const quiet = console.error;
    console.error = () => {};
    try {
      for (let sample = 1; sample < HYDE_DRAWS; sample++) {
        for (const q of single) {
          if (!has(...hydeRequest(q.question, sample))) {
            hydeMissing++;
            rerankMissing++;
            continue;
          }
          const before = probe.stats.failures.length;
          await retrieve(q.question, [], { hyde: true, rerank: true, llm: probe.llm, hydeSample: sample });
          if (probe.stats.failures.length > before) rerankMissing++;
        }
      }
    } finally {
      console.error = quiet;
    }
    console.log(
      `HyDE variance: ${hydeMissing} of ${single.length * (HYDE_DRAWS - 1)} extra HyDE passages and ` +
        `${rerankMissing} production reranks missing from the cache. ` +
        `At most ${hydeMissing + rerankMissing} API calls. No calls made.`
    );
    return;
  }
  const results = { model: MODEL, points, configs: {}, comparisons: [] };
  let totalFallbacks = 0;

  const record = async (config, set, qs, queryOf, historyOf) => {
    process.stdout.write(`${config.label.padEnd(42)} `);
    const { perQuestion, fallbacks } = await runConfig(config, qs, llm, queryOf, historyOf);
    totalFallbacks += fallbacks;
    results.configs[config.id] = {
      label: config.label,
      set,
      metrics: aggregate(Object.values(perQuestion)),
      perQuestion,
    };
  };

  for (const c of SINGLE_TURN_CONFIGS) {
    await record(c, "single-turn", single, (q) => q.question, () => []);
  }

  // Both variance rows share a draw's HyDE passage; the reranked row then
  // adds a rerank call, so each missing passage costs at most 2 calls.
  results.hydeVariance = { configs: {}, fallbacks: 0 };
  for (const id of HYDE_VARIANCE_CONFIGS) {
    const base = SINGLE_TURN_CONFIGS.find((c) => c.id === id);
    const draws = [results.configs[id].perQuestion];
    for (let sample = 1; sample < HYDE_DRAWS; sample++) {
      const config = { ...base, label: `${base.label}, draw ${sample + 1}`, opts: { ...base.opts, hydeSample: sample } };
      process.stdout.write(`${config.label.padEnd(42)} `);
      const { perQuestion, fallbacks } = await runConfig(config, single, llm, (q) => q.question, () => []);
      results.hydeVariance.fallbacks += fallbacks;
      draws.push(perQuestion);
    }
    results.hydeVariance.configs[id] = { label: base.label, ...summarizeDraws(draws) };
  }
  for (const c of MULTI_TURN_CONFIGS) {
    const config = { ...c, opts: { condense: c.condense, hyde: true, rerank: true } };
    await record(config, "multi-turn", multi, c.query, (q) => q.history);
  }

  for (const [candidate, baseline] of COMPARISONS) {
    const a = results.configs[candidate].perQuestion;
    const b = results.configs[baseline].perQuestion;
    const ids = Object.keys(a);
    results.comparisons.push({
      candidate,
      baseline,
      wins: ids.filter((id) => a[id].rank != null && b[id].rank == null).length,
      losses: ids.filter((id) => a[id].rank == null && b[id].rank != null).length,
    });
  }

  const answers = {};
  results.citations = await runCitationCheck(questions, llm, answers);
  results.notCovered = notCovered.map((q) => ({
    id: q.id,
    question: q.question,
    saysNotCovered: saysNotCovered(answers[q.id]),
    answer: answers[q.id],
  }));

  console.log(`\nLLM: ${stats.calls} API calls, ${stats.hits} cache hits, ${stats.failures.length} failures.`);
  if (stats.failures.length) {
    console.error(
      `Run invalid: ${stats.failures.length} LLM calls failed, so some stages silently fell back. ` +
        "Results not written. Re-run; successful calls are cached."
    );
    process.exit(1);
  }
  results.rerankParseFallbacks = totalFallbacks;

  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(results, null, 2) + "\n");
  const md = toMarkdown(results);
  fs.writeFileSync(path.join(__dirname, "results.md"), md);
  console.log("\n" + md);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
