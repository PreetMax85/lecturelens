const test = require("node:test");
const assert = require("node:assert/strict");
const { saysNotCovered, summarizeDraws, signTestP } = require("./metrics");

const score = (rank, poolHit = true) => ({ rank, lessonRank: rank, poolHit, poolSize: 10, returned: 5 });

test("summarizes each metric across draws as min, mean and max", () => {
  const draws = [
    { a: score(1), b: score(null, false) },
    { a: score(2), b: score(1) },
  ];
  const s = summarizeDraws(draws);
  assert.equal(s.draws, 2);
  assert.deepEqual(s.hit1, { min: 0.5, mean: 0.5, max: 0.5 });
  assert.deepEqual(s.hit5, { min: 0.5, mean: 0.75, max: 1 });
  assert.deepEqual(s.mrr5, { min: 0.5, mean: 0.625, max: 0.75 });
  assert.deepEqual(s.recall10, { min: 0.5, mean: 0.75, max: 1 });
});

test("counts questions whose hit@k changes between any two draws", () => {
  const draws = [
    { a: score(1), b: score(null), c: score(3) },
    { a: score(4), b: score(null), c: score(null) },
    { a: score(2), b: score(2), c: score(3) },
  ];
  assert.equal(summarizeDraws(draws).flips, 2);
  assert.deepEqual(summarizeDraws(draws).flipped, ["b", "c"]);
});

test("recognises the answer prompt's own refusal wording", () => {
  assert.equal(saysNotCovered("I couldn't find that in the course."), true);
  assert.equal(saysNotCovered("I couldn't find anything relevant to that in the course content."), true);
});

test("recognises other ways of saying the course doesn't cover it", () => {
  assert.equal(saysNotCovered("The course does not cover RevenueCat."), true);
  assert.equal(saysNotCovered("Background audio isn't covered in the provided excerpts."), true);
  assert.equal(saysNotCovered("The excerpts don't mention Apple Pay."), true);
  assert.equal(saysNotCovered("There is no information about Bluetooth pairing in the course."), true);
});

test("does not flag an answer that explains how to do it", () => {
  const answer =
    "Use the useCameraPermissions hook and check permission.granted " +
    "(Module 8, Lesson: Getting Started with Expo Camera, at 08:16 – 08:58).";
  assert.equal(saysNotCovered(answer), false);
});

test("signTestP is the exact two-sided sign test on discordant pairs", () => {
  // 9 vs 3: 2 * (C(12,0)+C(12,1)+C(12,2)+C(12,3)) / 2^12 = 598 / 4096
  assert.ok(Math.abs(signTestP(3, 9) - 598 / 4096) < 1e-12);
  assert.equal(signTestP(9, 3), signTestP(3, 9));
  // 8 vs 2: 2 * (1 + 10 + 45) / 1024
  assert.ok(Math.abs(signTestP(8, 2) - 112 / 1024) < 1e-12);
});

test("signTestP caps at 1 and handles no discordant pairs", () => {
  assert.equal(signTestP(0, 0), 1);
  assert.equal(signTestP(2, 2), 1);
});

test("signTestP rejects negative or fractional counts", () => {
  assert.throws(() => signTestP(-1, 2), /non-negative integers/);
  assert.throws(() => signTestP(1.5, 2), /non-negative integers/);
});
