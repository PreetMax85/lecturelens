// One chat turn, as both the server and eval/perf.js run it.
//
// The guardrail and retrieval start at the same time. Waiting for the
// guardrail first used to put its whole round trip (about a second) in front
// of everything else. The answer call still waits for the guardrail's verdict,
// so a rejected message never produces an answer. What a rejection wastes is
// the retrieval calls already in flight (HyDE, plus condensation on a
// follow-up); retrieval is told to stop before its rerank call.
//
// `emit` receives events as the turn progresses, for the streaming endpoint:
//   { type: "sources", sources }  the excerpts the answer will be built on
//   { type: "delta", text }       the next piece of the answer
// The return value is the complete result, the same shape /chat returns.

const { generate } = require("./gemini");
const { checkGuardrail } = require("./guardrail");
const { retrieve: retrieveExcerpts, answerFromResults, toSources } = require("./answer");
const { NOOP_TRACE } = require("./trace");

const BLOCKED_ANSWER =
  "I can only help with questions about this course and building apps with React Native and Expo. What would you like to know?";

async function handleChat(
  message,
  history = [],
  { llm = generate, trace = NOOP_TRACE, emit = () => {}, retrieve = retrieveExcerpts } = {}
) {
  let rejected = false;
  const verdict = checkGuardrail(message, history, { llm, trace }).then((allowed) => {
    if (!allowed) rejected = true;
    return allowed;
  });
  // Settled into a value so a failure nobody waits for (after a rejection)
  // cannot surface as an unhandled rejection.
  const retrieval = retrieve(message, history, { llm, trace, cancelled: () => rejected }).then(
    (value) => ({ value }),
    (error) => ({ error })
  );

  if (!(await verdict)) {
    return { answer: BLOCKED_ANSWER, sources: [], blocked: true };
  }

  const { value, error } = await retrieval;
  if (error) throw error;
  const { results } = value;

  if (results.length) {
    trace.mark("sources");
    emit({ type: "sources", sources: toSources(results) });
  }

  return answerFromResults(message, history, results, {
    llm,
    trace,
    onText: (text) => {
      trace.mark("first-token");
      emit({ type: "delta", text });
    },
  });
}

module.exports = { handleChat, BLOCKED_ANSWER };
