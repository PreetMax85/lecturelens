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

test("splits a compound citation joined by 'and' into one citation per range", () => {
  const cs = extractCitations(
    "(Module 7, Lesson: Magnetometer   Turn Your App Into a Digital Compass, at 03:36 – 04:20 and 05:47 – 06:28)"
  );
  assert.deepEqual(
    cs.map((c) => [c.module, c.lesson, c.start, c.end]),
    [
      ["Module 7", "Magnetometer   Turn Your App Into a Digital Compass", 216, 260],
      ["Module 7", "Magnetometer   Turn Your App Into a Digital Compass", 347, 388],
    ]
  );
});

test("splits three ranges listed with commas and a final 'and'", () => {
  const cs = extractCitations(
    "(Module 8, Lesson: Microphone & Audio in Expo   Permissions, Recording & Playback, at 02:11 – 02:51, 02:53 – 03:37, and 03:37 – 04:19)."
  );
  assert.equal(cs.length, 3);
  assert.equal(cs[0].lesson, "Microphone & Audio in Expo   Permissions, Recording & Playback");
  assert.deepEqual(
    cs.map((c) => [c.start, c.end]),
    [
      [131, 171],
      [173, 217],
      [217, 259],
    ]
  );
});

test("splits ranges separated by semicolons, including single timestamps", () => {
  const cs = extractCitations("(Module 14, Lesson: EAS Update, at 03:29 – 04:09; 04:09 – 04:48; 05:10)");
  assert.deepEqual(
    cs.map((c) => [c.start, c.end]),
    [
      [209, 249],
      [249, 288],
      [310, 310],
    ]
  );
});

test("does not read a prose timestamp after an unclosed citation as another range", () => {
  const lesson = "Module 3, Lesson: Foo, at 01:00 – 02:00";
  for (const tail of [", 10:30 AM is the deadline", " and 2:00 more minutes", ", and 03:00-ish"]) {
    const cs = extractCitations(lesson + tail);
    assert.equal(cs.length, 1, tail);
    assert.equal(cs[0].text, lesson, tail);
  }
});

test("does not read a longer digit run as a timestamp", () => {
  const cs = extractCitations("Module 3, Lesson: Foo, at 01:00 – 02:00, 12:345");
  assert.equal(cs.length, 1);
});

test("gives every range of a compound citation the full citation text", () => {
  const text = "Module 14, Lesson: EAS Update, at 03:29 – 04:09 and 04:09 – 04:48";
  const cs = extractCitations(`See (${text}).`);
  assert.deepEqual(
    cs.map((c) => c.text),
    [text, text]
  );
});

test("still reads a full second citation after a semicolon as its own lesson", () => {
  const cs = extractCitations(
    "(Module 17, Lesson: Chapter 4, at 02:07 – 02:50; Module 14, Lesson: EAS Update, at 04:09 – 04:48)"
  );
  assert.deepEqual(
    cs.map((c) => [c.module, c.lesson, c.start]),
    [
      ["Module 17", "Chapter 4", 127],
      ["Module 14", "EAS Update", 249],
    ]
  );
});

test("verifies each range of a compound citation separately", () => {
  const r = verifyCitations(
    "(Module 13, Lesson: Implementing Google OAuth, at 04:12 – 05:30 and 00:00 – 00:45)",
    sources
  );
  assert.equal(r.total, 2);
  assert.equal(r.verified, 1);
  assert.deepEqual(
    r.citations.map((c) => c.status),
    ["verified", "wrong_timestamp"]
  );
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
