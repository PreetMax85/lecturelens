// Disk-cached, rate-limited wrapper around gemini.generate for eval runs.
// The free-tier quota is tight, so every response is cached by a hash of
// (model, system prompt, prompt, temperature, sample). The cache is committed, so
// re-running the eval reproduces the published numbers with zero API calls.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generate, MODEL } = require("../src/gemini");

const CACHE_PATH = process.env.EVAL_CACHE_PATH || path.join(__dirname, "cache", "llm.json");
const MIN_INTERVAL_MS = Number(process.env.EVAL_MIN_INTERVAL_MS || 4000);
const MAX_ATTEMPTS = 5;

// `sample` asks for another independent draw of the same call (HyDE runs at
// temperature 0.4). It joins the key only when above 0, so sample 0 keeps the
// original key and the committed cache stays valid.
function cacheKey(model, prompt, opts = {}) {
  const parts = [model, opts.systemInstruction || "", prompt, opts.temperature ?? null];
  if (opts.sample > 0) parts.push(opts.sample);
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function createCachedLlm({ cacheOnly = false } = {}) {
  const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
  const stats = { hits: 0, calls: 0, failures: [] };
  let lastCallAt = 0;

  function save() {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(CACHE_PATH, JSON.stringify(sorted, null, 2) + "\n");
  }

  async function llm(prompt, opts = {}) {
    const key = cacheKey(MODEL, prompt, opts);

    if (key in cache) {
      stats.hits++;
      return cache[key];
    }
    if (cacheOnly) {
      const err = new Error("cache miss in --cache-only mode");
      stats.failures.push(err.message);
      throw err;
    }

    for (let attempt = 1; ; attempt++) {
      const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCallAt = Date.now();
      stats.calls++;
      try {
        const text = await generate(prompt, opts);
        cache[key] = text;
        save(); // persist after every call so a crash mid-run loses nothing
        return text;
      } catch (err) {
        const status = Number((err.message.match(/failed: (\d{3})/) || [])[1]);
        const retryable = status === 429 || status >= 500;
        if (!retryable || attempt === MAX_ATTEMPTS) {
          stats.failures.push(err.message.slice(0, 200));
          throw err;
        }
        const backoff = 2000 * 2 ** attempt;
        console.warn(`  [llm] ${status}, retrying in ${backoff / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  // Lets a dry run count cache misses before spending any quota.
  const has = (prompt, opts = {}) => cacheKey(MODEL, prompt, opts) in cache;

  return { llm, has, stats };
}

module.exports = { createCachedLlm, cacheKey };
