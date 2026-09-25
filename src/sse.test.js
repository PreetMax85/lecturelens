const test = require("node:test");
const assert = require("node:assert/strict");

const { createSseParser } = require("./sse");

function collect() {
  const events = [];
  const parser = createSseParser((data) => events.push(data));
  return { events, parser };
}

test("hands over the data of each complete event", () => {
  const { events, parser } = collect();
  parser.push('data: {"a":1}\n\ndata: {"b":2}\n\n');
  assert.deepEqual(events, ['{"a":1}', '{"b":2}']);
});

test("holds an event split across network chunks until it is complete", () => {
  const { events, parser } = collect();
  parser.push('data: {"te');
  parser.push('xt":"hi"}\n');
  assert.deepEqual(events, []);
  parser.push("\n");
  assert.deepEqual(events, ['{"text":"hi"}']);
});

test("accepts CRLF line endings", () => {
  const { events, parser } = collect();
  parser.push('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n');
  assert.deepEqual(events, ['{"a":1}', '{"b":2}']);
});

test("joins a multi-line data field with newlines", () => {
  const { events, parser } = collect();
  parser.push("data: first\ndata: second\n\n");
  assert.deepEqual(events, ["first\nsecond"]);
});

test("skips comments and events without data", () => {
  const { events, parser } = collect();
  parser.push(": keep-alive\n\nevent: ping\n\ndata: real\n\n");
  assert.deepEqual(events, ["real"]);
});

test("end() hands over a last event the stream closed without a blank line after", () => {
  const { events, parser } = collect();
  parser.push("data: last");
  parser.end();
  assert.deepEqual(events, ["last"]);
});

test("accepts a CRLF pair split across two chunks", () => {
  const { events, parser } = collect();
  parser.push("data: a\r");
  parser.push("\n\r\n");
  assert.deepEqual(events, ["a"]);
});
