// Relevance matching and retrieval metrics.
//
// A retrieved chunk is a strict hit if it comes from the labeled lesson AND
// its time range overlaps a labeled window by at least MIN_OVERLAP_S seconds
// (so a chunk that merely touches the window boundary doesn't count). A
// lesson-level hit only requires the right lesson.

const MIN_OVERLAP_S = 1;

function toSeconds(ts) {
  return ts.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

function sameLesson(payload, exp) {
  return payload.module === exp.module && payload.lessonFolder === exp.lesson;
}

function overlapsWindow(payload, exp) {
  const overlap = Math.min(payload.end, toSeconds(exp.end)) - Math.max(payload.start, toSeconds(exp.start));
  return sameLesson(payload, exp) && overlap >= MIN_OVERLAP_S;
}

// 1-based rank of the first result satisfying `match`, or null.
function firstRank(results, expected, match) {
  const i = results.findIndex((r) => expected.some((exp) => match(r.payload, exp)));
  return i === -1 ? null : i + 1;
}

function scoreQuestion(q, { candidates, results }) {
  return {
    rank: firstRank(results, q.expected, overlapsWindow),
    lessonRank: firstRank(results, q.expected, sameLesson),
    poolHit: firstRank(candidates, q.expected, overlapsWindow) != null,
    poolSize: candidates.length,
  };
}

function aggregate(scores) {
  const n = scores.length;
  const mean = (f) => (n ? scores.reduce((acc, s) => acc + f(s), 0) / n : 0);
  return {
    n,
    hit1: mean((s) => (s.rank === 1 ? 1 : 0)),
    hit5: mean((s) => (s.rank != null ? 1 : 0)),
    mrr5: mean((s) => (s.rank != null ? 1 / s.rank : 0)),
    lessonHit5: mean((s) => (s.lessonRank != null ? 1 : 0)),
    recall10: mean((s) => (s.poolHit ? 1 : 0)),
    avgPool: mean((s) => s.poolSize),
  };
}

module.exports = { toSeconds, overlapsWindow, scoreQuestion, aggregate };
