// Groups raw subtitle cues into larger chunks suitable for embedding.
// Each chunk keeps the start time of its first cue and end time of its
// last cue, so we can cite an exact timestamp range back to the student.

const DEFAULT_MAX_CHUNK_SECONDS = 45; // group cues until this many seconds covered
const DEFAULT_MAX_CHUNK_CHARS = 800; // or until this much text collected, whichever first

function chunkCues(cues, opts = {}) {
  const maxSeconds = opts.maxChunkSeconds || DEFAULT_MAX_CHUNK_SECONDS;
  const maxChars = opts.maxChunkChars || DEFAULT_MAX_CHUNK_CHARS;

  const chunks = [];
  let current = null;

  for (const cue of cues) {
    if (!current) {
      current = { start: cue.start, end: cue.end, text: cue.text };
      continue;
    }

    const wouldBeDuration = cue.end - current.start;
    const wouldBeChars = current.text.length + cue.text.length + 1;

    if (wouldBeDuration > maxSeconds || wouldBeChars > maxChars) {
      chunks.push(current);
      current = { start: cue.start, end: cue.end, text: cue.text };
    } else {
      current.end = cue.end;
      current.text += " " + cue.text;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

function formatTimestamp(totalSeconds) {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

module.exports = { chunkCues, formatTimestamp };
