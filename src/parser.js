// Parses .srt or .vtt content into an array of cues: { start, end, text }
// start/end are in seconds (float). Auto-detects format, handles both
// comma-decimal SRT timestamps and dot-decimal WEBVTT timestamps.

function timeToSeconds(t) {
  // t like "00:00:05,640" or "00:00:05.640"
  const norm = t.replace(",", ".").trim();
  const [h, m, s] = norm.split(":");
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
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
    const start = timeToSeconds(match[1]);
    const end = timeToSeconds(match[2]);
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
