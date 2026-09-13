// Guardrail check for LectureLens.
//
// Usage: node eval/guardrail.js [--cache-only]
//
// Every labeled question in eval/questions.json is a real course question,
// so the guardrail must allow all of them. eval/guardrail-cases.json adds
// short on-topic phrasings that must be allowed and off-topic or injection
// messages that must be rejected. Runs checkGuardrail() from src/guardrail.js
// (the production code path) and exits 1 on any wrong verdict.
//
// --cache-only  fail on any Gemini cache miss instead of calling the API.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { checkGuardrail } = require("../src/guardrail");
const { createCachedLlm } = require("./llm-cache");

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));

async function main() {
  const cacheOnly = process.argv.includes("--cache-only");
  const labeled = readJson("questions.json");
  const cases = readJson("guardrail-cases.json");

  const expectations = [
    ...labeled.map((q) => ({ ...q, want: true })),
    ...cases.allow.map((q) => ({ ...q, want: true })),
    ...cases.reject.map((q) => ({ ...q, want: false })),
  ];

  const { llm, stats } = createCachedLlm({ cacheOnly });
  const wrong = [];
  for (const q of expectations) {
    const allowed = await checkGuardrail(q.question, q.history || [], { llm });
    if (allowed !== q.want) wrong.push(q);
    process.stdout.write(allowed === q.want ? "." : "x");
  }
  process.stdout.write("\n");

  console.log(`LLM: ${stats.calls} API calls, ${stats.hits} cache hits, ${stats.failures.length} failures.`);
  if (stats.failures.length) {
    // checkGuardrail fails open, so a failed call would pass as ALLOW.
    console.error(`Run invalid: ${stats.failures.length} LLM calls failed. Re-run; successful calls are cached.`);
    process.exit(1);
  }

  const shouldAllow = expectations.filter((q) => q.want).length;
  const shouldReject = expectations.length - shouldAllow;
  const falseRejects = wrong.filter((q) => q.want);
  const falseAllows = wrong.filter((q) => !q.want);
  console.log(`Allowed ${shouldAllow - falseRejects.length} of ${shouldAllow} course questions.`);
  console.log(`Rejected ${shouldReject - falseAllows.length} of ${shouldReject} off-topic messages.`);
  for (const q of wrong) {
    console.log(`  ${q.id} wrongly ${q.want ? "rejected" : "allowed"}: ${q.question}`);
  }
  if (wrong.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
