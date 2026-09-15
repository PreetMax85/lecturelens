const test = require("node:test");
const assert = require("node:assert/strict");
const { saysNotCovered } = require("./metrics");

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
