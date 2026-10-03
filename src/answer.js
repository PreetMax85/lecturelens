const { embedText } = require("./local-embed");
const { generate } = require("./gemini");
const { search } = require("./qdrant");
const { formatTimestamp } = require("./chunker");
const { formatHistory } = require("./history-format");
const { verifyCitations } = require("./citations");
const { NOOP_TRACE } = require("./trace");

function buildContext(results) {
  return results
    .map(
      (r, i) => {
        const startTs = r.payload.timestamp;
        const endTs = r.payload.end != null ? formatTimestamp(r.payload.end) : null;
        const tsLabel = endTs && endTs !== startTs ? `${startTs} – ${endTs}` : startTs;
        return `[Source ${i + 1}]\nModule: ${r.payload.module}\nLesson: ${r.payload.lesson}\nTimestamp: ${tsLabel}\nTranscript:\n${r.payload.text}`;
      }
    )
    .join("\n\n---\n\n");
}

const ANSWER_SYSTEM = `You are a helpful teaching assistant for a video course.
Answer the student's question using ONLY the provided source excerpts below for
any factual claim about course content. If the excerpts don't contain the
answer, say you couldn't find that in the course.

You may see recent conversation turns for context (so you can handle
follow-ups naturally) - use them to understand what the student means, but
still ground every factual claim in the source excerpts, not in the prior
conversation.

Cite where information came from using this exact format: (<module>, Lesson: <lesson>, at <timestamp>)
e.g. (Module 13, Lesson: Implementing Google OAuth, at 04:12 – 05:30)

CRITICAL TIMESTAMP RULE: Each source excerpt has a "Timestamp:" field showing
a time range (e.g. "02:10 – 03:15"). When you cite a source, you MUST use the
EXACT timestamp range from that source's Timestamp field. Do NOT default to
00:00 or invent a timestamp. If Source 1 says "Timestamp: 15:42 – 16:20" and
Source 2 says "Timestamp: 02:48 – 03:30", cite them with those exact ranges.
Always read the
Timestamp field of the specific source you are referencing.

Important: cite each fact ONCE. If a sentence already states the module, lesson,
or timestamp directly (e.g. answering "when was X taught"), do NOT also add a
parenthetical citation repeating the same module/lesson/timestamp right after it -
that's redundant. Only add a parenthetical citation for sentences that describe
content WITHOUT already naming its source inline.

If asked "when was X taught", answer directly with the module, lesson, and
timestamp stated naturally in the sentence itself - don't follow it with a
citation that just repeats what you already said.`;

const CONDENSE_SYSTEM = `Given recent conversation history and a student's new
message, rewrite the new message as a standalone question that makes sense
without needing the history - resolve pronouns and vague references like
"that", "it", "what about X" using the history.

If the new message is already a standalone question unrelated to the history,
return it completely unchanged. Respond with ONLY the rewritten (or unchanged)
question, nothing else - no preamble, no quotes.`;

async function condenseQuery(userMessage, history, llm = generate, trace = NOOP_TRACE) {
  if (!history || history.length === 0) return userMessage;
  try {
    const rewritten = await trace.span("condense", () =>
      llm(
        `Conversation so far:\n${formatHistory(history, 6)}\n\nNew message: ${userMessage}`,
        { systemInstruction: CONDENSE_SYSTEM, temperature: 0, onUsage: trace.onUsage("condense") }
      )
    );
    return rewritten.trim() || userMessage;
  } catch (err) {
    console.error("[condense] failed, using raw message:", err.message);
    return userMessage;
  }
}

const HYDE_SYSTEM = `You are helping retrieve relevant transcript excerpts from a spoken video course.
Given a student's question, write a short (2-4 sentence) hypothetical answer as if it were
spoken naturally by a course instructor explaining the topic - use the casual, explanatory
tone and vocabulary an instructor would actually use in a lecture, not a formal encyclopedia
answer. This hypothetical passage is only used to improve semantic search - it is never
shown to the student.`;

// The exact (prompt, opts) of a HyDE call, shared with the eval's dry run so
// it can check the cache for these calls without making them.
function hydeRequest(question, sample = 0) {
  return [question, { systemInstruction: HYDE_SYSTEM, temperature: 0.4, sample }];
}

async function generateHydePassage(question, llm = generate, sample = 0, trace = NOOP_TRACE) {
  try {
    const [prompt, opts] = hydeRequest(question, sample);
    return await trace.span("hyde", () =>
      llm(prompt, { ...opts, onUsage: trace.onUsage("hyde") })
    );
  } catch (err) {
    console.error("[hyde] generation failed, falling back to raw query only:", err.message);
    return null;
  }
}

function mergeResults(resultSets, limit) {
  const byId = new Map();
  for (const results of resultSets) {
    for (const r of results) {
      const existing = byId.get(r.id);
      if (!existing || r.score > existing.score) byId.set(r.id, r);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

const RERANK_SYSTEM = `You are reranking search results for a course Q&A system.
Given a student's question and a numbered list of candidate transcript excerpts,
return ONLY a JSON array of the candidate numbers ordered from MOST to LEAST
relevant to answering the question. Exclude numbers for excerpts that are not
actually relevant. Respond with ONLY the JSON array, e.g. [3,1,5] - no other
text, no explanation, no markdown fences.`;

const RERANK_TEXT_CHARS = 300; // excerpt slice shown to the reranker per candidate

async function rerankResults(question, results, llm = generate, trace = NOOP_TRACE) {
  if (results.length <= 1) return results;

  const listing = results
    .map(
      (r, i) =>
        `${i + 1}. [${r.payload.module} | ${r.payload.lesson} | ${r.payload.timestamp}] ${r.payload.text.slice(0, RERANK_TEXT_CHARS)}`
    )
    .join("\n\n");

  try {
    const raw = await trace.span("rerank", () =>
      llm(`Question: ${question}\n\nCandidates:\n${listing}`, {
        systemInstruction: RERANK_SYSTEM,
        temperature: 0,
        onUsage: trace.onUsage("rerank"),
      })
    );
    const match = raw.match(/\[[\d,\s]*\]/);
    if (!match) throw new Error("no JSON array found in rerank response");
    const order = JSON.parse(match[0]);
    const reranked = order.map((n) => results[n - 1]).filter(Boolean);
    return reranked.length ? reranked : results; // fallback if parsing produced nothing usable
  } catch (err) {
    console.error("[rerank] failed, falling back to vector-score order:", err.message);
    return results;
  }
}

const CANDIDATE_POOL = 10;
const FINAL_K = 5;

// Retrieval half of the pipeline. Each stage can be switched off so
// eval/run.js can ablate them; production always runs with all stages on.
// `llm` is injectable so the eval can cache and rate-limit Gemini calls.
// `cancelled` lets src/chat.js abandon a retrieval whose message the guardrail
// has since rejected. It is checked after condensation and before rerank, the
// points after which the next step is another LLM call.
async function retrieve(
  userMessage,
  history = [],
  {
    condense = true,
    hyde = true,
    rerank = true,
    llm = generate,
    hydeSample = 0,
    trace = NOOP_TRACE,
    cancelled = () => false,
  } = {}
) {
  const standaloneQuery = condense
    ? await condenseQuery(userMessage, history, llm, trace)
    : userMessage;
  if (cancelled()) return { standaloneQuery, candidates: [], results: [] };

  const [queryVector, hydePassage] = await Promise.all([
    trace.span("embed-query", () => embedText(standaloneQuery)),
    hyde ? generateHydePassage(standaloneQuery, llm, hydeSample, trace) : null,
  ]);

  // Two searches of 8 merge to up to 10 unique candidates; without a HyDE
  // passage, fetch the full pool from the raw query instead.
  const searchPromises = [
    trace.span("search", () => search(queryVector, hydePassage ? 8 : CANDIDATE_POOL)),
  ];
  if (hydePassage) {
    const hydeVector = await trace.span("embed-hyde", () => embedText(hydePassage));
    searchPromises.push(trace.span("search", () => search(hydeVector, 8)));
  }

  const resultSets = await Promise.all(searchPromises);
  const candidates = mergeResults(resultSets, CANDIDATE_POOL);
  if (cancelled()) return { standaloneQuery, candidates, results: [] };

  const ordered = rerank
    ? await rerankResults(standaloneQuery, candidates, llm, trace)
    : candidates;
  return { standaloneQuery, candidates, results: ordered.slice(0, FINAL_K) };
}

// The sources as the student sees them, one per excerpt the answer was built on.
function toSources(results) {
  return results.map((r) => {
    const startTs = r.payload.timestamp;
    const endTs = r.payload.end != null ? formatTimestamp(r.payload.end) : null;
    return {
      module: r.payload.module,
      lesson: r.payload.lesson,
      timestamp: endTs && endTs !== startTs ? `${startTs} – ${endTs}` : startTs,
      score: r.score,
    };
  });
}

// Generation half of the pipeline: writes the answer from already retrieved
// excerpts and checks its citations against them. `onText`, if given, gets the
// answer as it streams; the returned answer is the same either way.
async function answerFromResults(userMessage, history, results, { llm = generate, trace = NOOP_TRACE, onText } = {}) {
  if (!results.length) {
    return {
      answer: "I couldn't find anything relevant to that in the course content.",
      sources: [],
      citationCheck: { total: 0, verified: 0, unverified: [] },
    };
  }

  const context = buildContext(results);
  const historyBlock = history.length ? `Recent conversation:\n${formatHistory(history, 6)}\n\n` : "";
  const prompt = `${ANSWER_SYSTEM}\n\n${historyBlock}Source excerpts:\n${context}\n\nStudent question: ${userMessage}`;

  const answer = await trace.span("answer", () =>
    llm(prompt, { temperature: 0.2, onUsage: trace.onUsage("answer"), onText })
  );

  const check = await trace.span("verify-citations", () =>
    verifyCitations(answer, results.map((r) => r.payload))
  );
  const unverified = check.citations
    .filter((c) => c.status !== "verified")
    .map(({ text, status }) => ({ text, status }));
  if (unverified.length) console.warn("[citations] unverified:", JSON.stringify(unverified));

  return {
    answer,
    citationCheck: { total: check.total, verified: check.verified, unverified },
    sources: toSources(results),
  };
}

async function answerQuestion(userMessage, history = [], { llm = generate, trace = NOOP_TRACE } = {}) {
  const { results } = await retrieve(userMessage, history, { llm, trace });
  return answerFromResults(userMessage, history, results, { llm, trace });
}

module.exports = { answerQuestion, answerFromResults, retrieve, toSources, hydeRequest };