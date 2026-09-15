// Relevance matching and retrieval metrics.
//
// A retrieved chunk is a strict hit if it comes from the labeled lesson AND
// its time range overlaps a labeled window by at least MIN_OVERLAP_S seconds
// (so a chunk that merely touches the window boundary doesn't count). A
// lesson-level hit only requires the right lesson, so it counts every strict
// hit plus the near misses and is always the larger number.
//
// `returned` is tracked because the rerank stage drops excerpts it judges
// irrelevant instead of padding the list, so hit@k and MRR@k are measured over
// fewer than 5 results on those configs. Shorter lists can only lose hits, so
// this handicaps the reranked rows rather than flattering them.

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
    returned: results.length,
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
    avgReturned: mean((s) => s.returned),
  };
}

// HyDE is sampled at temperature 0.4, so a HyDE row is one draw of a noisy
// number. `draws` holds one perQuestion score map per draw, all over the same
// questions. Flips counts questions that are a hit@k in some draws and a miss
// in others, which says whether the spread comes from a few unstable
// questions or from many.
function summarizeDraws(draws) {
  const metrics = draws.map((d) => aggregate(Object.values(d)));
  const spread = (key) => {
    const values = metrics.map((m) => m[key]);
    return {
      min: Math.min(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      max: Math.max(...values),
    };
  };
  const flips = Object.keys(draws[0]).filter(
    (id) => new Set(draws.map((d) => d[id].rank != null)).size > 1
  ).length;
  return {
    draws: draws.length,
    hit1: spread("hit1"),
    hit5: spread("hit5"),
    mrr5: spread("mrr5"),
    recall10: spread("recall10"),
    flips,
  };
}

// A question the course doesn't cover should get an answer that says so. The
// answer prompt asks for "couldn't find that in the course", but the model
// words it several ways, so this matches the common phrasings. It can't tell
// whether the rest of the answer invents steps anyway, so those answers are
// also read by hand.
const NOT_COVERED =
  /\b(couldn['’]t|could not|can['’]t|cannot|unable to) find\b|\b(isn['’]t|is not|aren['’]t|are not|not) (covered|mentioned|discussed)\b|\b(doesn['’]t|does not|don['’]t|do not) (cover|mention|discuss|include)\b|\bno (information|mention|details?)\b/i;

function saysNotCovered(answer) {
  return NOT_COVERED.test(answer);
}

module.exports = { toSeconds, overlapsWindow, scoreQuestion, aggregate, summarizeDraws, saysNotCovered };
