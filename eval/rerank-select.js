// Selection logic for eval/rerank-bakeoff.js.
//
// A cross-encoder scores every candidate, so turning its scores into a result
// list is two steps: order the pool by score, then cut it to some k. The
// bake-off cuts at the production FINAL_K and, separately, at however many
// results the LLM reranker returned for the same question, so the two can be
// compared at equal list length.

// Candidates sorted by descending score. Exact ties keep the vector order
// (Array.prototype.sort is stable), so the result never depends on sort
// internals.
function orderByScores(candidates, scores) {
  if (candidates.length !== scores.length) {
    throw new Error(`${candidates.length} candidates but ${scores.length} scores`);
  }
  return candidates
    .map((candidate, i) => ({ candidate, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.candidate);
}

function cutToK(results, k) {
  if (!Number.isInteger(k) || k < 0) throw new Error(`k must be a non-negative integer, got ${k}`);
  return results.slice(0, k);
}

module.exports = { orderByScores, cutToK };
