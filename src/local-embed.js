// Local embeddings via transformers.js - runs entirely on CPU, no API
// calls, no rate limits. First run downloads the quantized model (~23MB)
// from Hugging Face and caches it under
// node_modules/@xenova/transformers/.cache; needs internet once, then works
// fully offline. `npm run build` does that download ahead of time.

const { pipeline } = require("@xenova/transformers");

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"; // 384-dim, small & fast
const INTERNAL_BATCH_SIZE = 32;

let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", MODEL_NAME);
  }
  return embedderPromise;
}

async function embedOneBatch(texts) {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  const [batchSize, dim] = output.dims;
  const vectors = [];
  for (let i = 0; i < batchSize; i++) {
    vectors.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

async function embedText(text) {
  const [vector] = await embedOneBatch([text]);
  return vector;
}

async function embedBatch(texts) {
  const results = [];
  for (let i = 0; i < texts.length; i += INTERNAL_BATCH_SIZE) {
    const slice = texts.slice(i, i + INTERNAL_BATCH_SIZE);
    const vectors = await embedOneBatch(slice);
    results.push(...vectors);
  }
  return results;
}

module.exports = { embedText, embedBatch, EMBED_DIM: 384 };
