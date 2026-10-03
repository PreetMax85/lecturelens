// Parses .srt or .vtt content into an array of cues: { start, end, text }
// start/end are in seconds (float). Auto-detects format, handles both
// comma-decimal SRT timestamps and dot-decimal WEBVTT timestamps.

function timeToSeconds(t) {
  // t like "00:00:05,640" or "00:00:05.640"
  if (typeof t !== "string") throw new Error(`invalid timestamp: ${String(t)}`);
  const norm = t.replace(",", ".").trim();
  const parts = norm.split(":");
  if (parts.length !== 3) throw new Error(`invalid timestamp: ${t}`);
  const [h, m, s] = parts;
  const hours = Number(h);
  const minutes = Number(m);
  const seconds = Number(s);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    throw new Error(`invalid timestamp: ${t}`);
  }
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60 || hours < 0) {
    throw new Error(`timestamp out of range: ${t}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function parseSubtitle(content) {
  // Strip WEBVTT header/metadata lines if present
  let text = content.replace(/^\uFEFF/, ""); // strip BOM
  text = text.replace(/^WEBVTT.*\n+/i, "");

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n");

  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const cues = [];

  const timeLineRe = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // Find the timestamp line (may be line 0 or line 1 depending on
    // whether a numeric index precedes it, as in SRT).
    let timeLineIdx = lines.findIndex((l) => timeLineRe.test(l));
    if (timeLineIdx === -1) continue; // not a cue block (e.g. stray metadata)

    const match = lines[timeLineIdx].match(timeLineRe);
    let start;
    let end;
    try {
      start = timeToSeconds(match[1]);
      end = timeToSeconds(match[2]);
    } catch {
      continue; // malformed timestamp line - skip rather than emit NaN
    }
    if (!(end > start)) continue;
    const cueText = lines
      .slice(timeLineIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip any inline VTT tags
      .trim();

    if (cueText) cues.push({ start, end, text: cueText });
  }

  return cues;
}

module.exports = { parseSubtitle, timeToSeconds };
