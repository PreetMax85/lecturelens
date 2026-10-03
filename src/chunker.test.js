const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkCues, formatTimestamp } = require("./chunker");

const cue = (start, end, text) => ({ start, end, text });

test("groups cues until the time or char budget is hit", () => {
  const chunks = chunkCues([cue(0, 10, "a"), cue(10, 20, "b"), cue(20, 70, "c")]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, "a b");
  assert.deepEqual([chunks[0].start, chunks[0].end], [0, 20]);
});

test("an explicit 0 budget throws instead of silently using the default", () => {
  assert.throws(() => chunkCues([cue(0, 1, "a")], { maxChunkSeconds: 0 }), /positive/);
});

test("formatTimestamp pads and drops the hour when zero", () => {
  assert.equal(formatTimestamp(65), "01:05");
  assert.equal(formatTimestamp(3723), "01:02:03");
});
