const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSubtitle, timeToSeconds } = require("./parser");

test("timeToSeconds parses SRT comma and VTT dot decimals", () => {
  assert.equal(timeToSeconds("00:00:05,640"), 5.64);
  assert.equal(timeToSeconds("01:02:03.500"), 3723.5);
});

test("timeToSeconds rejects malformed or out-of-range input", () => {
  for (const bad of ["not-a-time", "00:00", "00:99:00,000", "00:00:99.000", "", null, 42]) {
    assert.throws(() => timeToSeconds(bad), /invalid|out of range/);
  }
});

test("parseSubtitle reads an SRT block with index and VTT tags", () => {
  const cues = parseSubtitle("1\n00:00:01,000 --> 00:00:04,000\nHello <b>world</b>\n");
  assert.deepEqual(cues, [{ start: 1, end: 4, text: "Hello world" }]);
});

test("parseSubtitle strips WEBVTT header and skips blocks without cues", () => {
  const cues = parseSubtitle("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n\nNOTE stray\n");
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, "Hi");
});

test("parseSubtitle skips cues whose end is not after start", () => {
  const cues = parseSubtitle("00:00:05,000 --> 00:00:04,000\nBackwards\n");
  assert.deepEqual(cues, []);
});
