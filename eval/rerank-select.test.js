const test = require("node:test");
const assert = require("node:assert/strict");
const { orderByScores, cutToK } = require("./rerank-select");

const c = (id) => ({ id, payload: {} });

test("orderByScores sorts candidates by descending score", () => {
  const ordered = orderByScores([c("a"), c("b"), c("c")], [0.1, 2.5, -1]);
  assert.deepEqual(ordered.map((r) => r.id), ["b", "a", "c"]);
});

test("orderByScores keeps the vector order on exact ties", () => {
  const ordered = orderByScores([c("a"), c("b"), c("c"), c("d")], [1, 3, 1, 3]);
  assert.deepEqual(ordered.map((r) => r.id), ["b", "d", "a", "c"]);
});

test("orderByScores does not mutate its inputs", () => {
  const candidates = [c("a"), c("b")];
  const scores = [1, 2];
  orderByScores(candidates, scores);
  assert.deepEqual(candidates.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(scores, [1, 2]);
});

test("orderByScores rejects a score list of the wrong length", () => {
  assert.throws(() => orderByScores([c("a"), c("b")], [1]), /2 candidates but 1 scores/);
});

test("cutToK keeps the first k results", () => {
  assert.deepEqual(cutToK([c("a"), c("b"), c("c")], 2).map((r) => r.id), ["a", "b"]);
});

test("cutToK returns everything when k exceeds the list", () => {
  assert.deepEqual(cutToK([c("a")], 5).map((r) => r.id), ["a"]);
});

test("cutToK with k 0 returns an empty list", () => {
  assert.deepEqual(cutToK([c("a")], 0), []);
});

test("cutToK rejects a negative or fractional k", () => {
  assert.throws(() => cutToK([c("a")], -1), /non-negative integer/);
  assert.throws(() => cutToK([c("a")], 1.5), /non-negative integer/);
});
