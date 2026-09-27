const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";
const { retrieve } = require("./answer");

test("a follow-up rejected while it is being condensed stops before HyDE, search and rerank", async () => {
  let rejected = false;
  const calls = [];
  async function llm(prompt, opts) {
    calls.push(opts.systemInstruction.split("\n")[0]);
    rejected = true; // the guardrail's verdict lands while condensation runs
    return "standalone question";
  }
  const { results } = await retrieve("what about iOS?", [{ role: "user", content: "push notifications?" }], {
    llm,
    cancelled: () => rejected,
  });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 1, `expected only the condensation call, got: ${calls.join(" | ")}`);
});
