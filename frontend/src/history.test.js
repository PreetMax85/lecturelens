import test from "node:test";
import assert from "node:assert/strict";

import { chatHistory } from "./history.js";

const GREETING = { role: "assistant", content: "Hi! Ask me anything." };

test("sends completed turns as role and content only, without the greeting", () => {
  const messages = [
    GREETING,
    { role: "user", content: "what is expo?" },
    { role: "assistant", content: "A framework.", sources: [{ lesson: "Intro" }] },
  ];
  assert.deepEqual(chatHistory(messages, GREETING.content), [
    { role: "user", content: "what is expo?" },
    { role: "assistant", content: "A framework." },
  ]);
});

test("leaves out a failed reply and the question it failed to answer", () => {
  const messages = [
    { role: "user", content: "q1" },
    { role: "assistant", content: "Something went wrong answering that.", failed: true },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ];
  assert.deepEqual(chatHistory(messages, GREETING.content), [
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ]);
});

test("leaves out a question whose reply never arrived, such as one lost to a reload", () => {
  const messages = [
    { role: "user", content: "q1" },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ];
  assert.deepEqual(chatHistory(messages, GREETING.content), [
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ]);
});

test("keeps only the last eight messages", () => {
  const messages = [];
  for (let i = 1; i <= 6; i++) {
    messages.push({ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` });
  }
  const history = chatHistory(messages, GREETING.content);
  assert.equal(history.length, 8);
  assert.equal(history[0].content, "q3");
});
