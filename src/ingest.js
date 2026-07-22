// Usage: node src/ingest.js <path-to-course-root>
// Expects: <root>/module N/<lesson-folder>/*.srt (or .vtt)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { parseSubtitle } = require("./parser");
const { chunkCues, formatTimestamp } = require("./chunker");
const { embedBatch } = require("./local-embed");
const { ensureCollection, upsertPoints } = require("./qdrant");

const EMBED_BATCH_SIZE = 50;

const ACRONYM_FIXES = {
  oauth: "OAuth",
  api: "API",
  apis: "APIs",
  eas: "EAS",
  sqlite: "SQLite",
  sql: "SQL",
  crud: "CRUD",
  ui: "UI",
  ux: "UX",
  ai: "AI",
  ios: "iOS",
  json: "JSON",
  http: "HTTP",
  url: "URL",
  id: "ID",
  github: "GitHub",
};

function fixAcronyms(title) {
  return title
    .split(" ")
    .map((word) => ACRONYM_FIXES[word.toLowerCase()] || word)
    .join(" ");
}

const SMALL_WORDS = new Set(["vs", "and", "or", "of", "the", "in", "to", "on", "with", "for", "a", "an"]);

function cleanLessonTitle(folderName) {
  // "01_what-is-mobile-development_epm" -> "What Is Mobile Development"
  let name = folderName.replace(/^\d+[_\-.]?\s*/, ""); // strip leading number
  name = name.replace(/_[a-z]{2,5}$/i, ""); // strip trailing short code suffix like _epm
  name = name.replace(/[-_]+/g, " ").trim();
  name = name
    .split(" ")
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return w[0] ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
    })
    .join(" ");
  return fixAcronyms(name);
}

function cleanModuleName(folderName) {
  // "module 13" -> "Module 13"; leaves suffixes like "module 1 hc" alone otherwise
  return folderName.replace(/^module/i, "Module");
}

function findSubtitleFile(lessonDir) {
  const files = fs.readdirSync(lessonDir);
  const srt = files.find((f) => f.toLowerCase().endsWith(".srt"));
  const vtt = files.find((f) => f.toLowerCase().endsWith(".vtt"));
  const chosen = srt || vtt;
  if (!chosen) return null;
  const full = path.join(lessonDir, chosen);
  // sanity check: skip files that clearly aren't real subtitle text
  // (e.g. corrupted/binary files from bad zips)
  const stat = fs.statSync(full);
  if (stat.size === 0) return null;
  return full;
}

async function ingestCourse(rootDir) {
  await ensureCollection();

  const moduleDirs = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  let allChunks = [];

  for (const moduleDir of moduleDirs) {
    const modulePath = path.join(rootDir, moduleDir.name);
    const lessonDirs = fs
      .readdirSync(modulePath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const lessonDir of lessonDirs) {
      const lessonPath = path.join(modulePath, lessonDir.name);
      const subFile = findSubtitleFile(lessonPath);
      if (!subFile) {
        console.warn(`  [skip] no usable subtitle file in ${lessonPath}`);
        continue;
      }

      const raw = fs.readFileSync(subFile, "utf8");
      const cues = parseSubtitle(raw);
      if (cues.length === 0) {
        console.warn(`  [skip] 0 cues parsed from ${subFile}`);
        continue;
      }

      const chunks = chunkCues(cues);
      const lessonTitle = cleanLessonTitle(lessonDir.name);

      for (const c of chunks) {
        allChunks.push({
          module: cleanModuleName(moduleDir.name),
          lesson: lessonTitle,
          lessonFolder: lessonDir.name,
          start: c.start,
          end: c.end,
          timestamp: formatTimestamp(c.start),
          text: c.text,
        });
      }

      console.log(`  ${moduleDir.name}/${lessonDir.name}: ${chunks.length} chunks`);
    }
  }

  console.log(`\nTotal chunks to embed: ${allChunks.length}`);

  // Embed + upsert in batches
  for (let i = 0; i < allChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedBatch(batch.map((c) => c.text));

    const points = batch.map((c, idx) => ({
      id: crypto.randomUUID(),
      vector: vectors[idx],
      payload: c,
    }));

    await upsertPoints(points);
    console.log(`  embedded+upserted ${i + batch.length}/${allChunks.length}`);
  }

  console.log("\nIngestion complete.");
}

const rootArg = process.argv[2];
if (!rootArg) {
  console.error("Usage: node src/ingest.js <path-to-course-root>");
  process.exit(1);
}

ingestCourse(path.resolve(rootArg)).catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});