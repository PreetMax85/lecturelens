const test = require("node:test");
const assert = require("node:assert/strict");
const { extractCitations, verifyCitations } = require("./citations");

const sources = [
  { module: "Module 13", lesson: "Implementing Google OAuth", start: 252.4, end: 330.9 },
  {
    module: "Module 10",
    lesson: "Configure, Create & Test EAS Development Builds - From Setup to Device",
    start: 61,
    end: 105.2,
  },
];

test("parses the parenthetical format with an en dash range", () => {
  const [c] = extractCitations("Use a redirect URI (Module 13, Lesson: Implementing Google OAuth, at 04:12 – 05:30).");
  assert.equal(c.module, "Module 13");
  assert.equal(c.lesson, "Implementing Google OAuth");
  assert.equal(c.start, 252);
  assert.equal(c.end, 330);
});

test("parses lesson titles containing commas and single timestamps", () => {
  const [c] = extractCitations(
    "It was covered in Module 10, Lesson: Configure, Create & Test EAS Development Builds - From Setup to Device, at 01:05."
  );
  assert.equal(c.lesson, "Configure, Create & Test EAS Development Builds - From Setup to Device");
  assert.equal(c.start, 65);
  assert.equal(c.end, 65);
});

test("parses several citations in one answer", () => {
  const answer =
    "First (Module 13, Lesson: Implementing Google OAuth, at 04:12 – 05:30). " +
    "Then (Module 1 hc, Lesson: Expo Version Change So Quickly, at 00:10 - 00:40).";
  assert.equal(extractCitations(answer).length, 2);
});

test("verifies a citation inside a source's range, case-insensitively", () => {
  const r = verifyCitations("(module 13, Lesson: implementing google oauth, at 04:12 – 05:30)", sources);
  assert.equal(r.total, 1);
  assert.equal(r.verified, 1);
});

test("flags a timestamp outside the matching source's range", () => {
  const r = verifyCitations("(Module 13, Lesson: Implementing Google OAuth, at 00:00 – 00:45)", sources);
  assert.equal(r.citations[0].status, "wrong_timestamp");
});

test("flags a lesson that wasn't among the sources", () => {
  const r = verifyCitations("(Module 12, Lesson: Push Notification, at 04:12 – 05:30)", sources);
  assert.equal(r.citations[0].status, "unknown_source");
});

test("returns zero citations for an answer without any", () => {
  assert.deepEqual(verifyCitations("I couldn't find that in the course.", sources), {
    total: 0,
    verified: 0,
    citations: [],
  });
});
