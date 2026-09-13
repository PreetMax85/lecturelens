// Downloads the embedding model into Transformers.js's cache at build time.
// Render's runtime disk is ephemeral, so a model fetched on first request is
// lost on every spin-down and re-downloaded on the next cold start. Files
// written during the build step are kept, so fetch it here instead.
// Render build command: npm install && npm run build

const { embedText } = require("../src/local-embed");

embedText("warmup")
  .then(() => console.log("Embedding model cached."))
  .catch((err) => {
    console.error("Model prefetch failed:", err);
    process.exit(1);
  });
