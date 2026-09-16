const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { cacheKey } = require("./llm-cache");

const legacyKey = (model, prompt, opts) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([model, opts.systemInstruction || "", prompt, opts.temperature ?? null]))
    .digest("hex");

test("sample 0 and no sample keep the original cache key", () => {
  const opts = { systemInstruction: "sys", temperature: 0.4 };
  assert.equal(cacheKey("m", "q", opts), legacyKey("m", "q", opts));
  assert.equal(cacheKey("m", "q", { ...opts, sample: 0 }), legacyKey("m", "q", opts));
});

test("a later sample gets its own key per index", () => {
  const opts = { systemInstruction: "sys", temperature: 0.4 };
  const keys = [0, 1, 2, 3].map((sample) => cacheKey("m", "q", { ...opts, sample }));
  assert.equal(new Set(keys).size, 4);
});
