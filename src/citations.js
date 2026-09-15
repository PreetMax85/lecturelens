// Deterministic citation check: every citation the model writes must point
// at one of the excerpts it was actually given. No LLM call involved.
//
// The answer prompt asks for "(Module 13, Lesson: Implementing Google OAuth,
// at 04:12 – 05:30)", and the same shape appears inline when the model
// states a location in prose. A citation is:
//   verified         module + lesson match a source and the cited range
//                    lies within that source's range
//   wrong_timestamp  module + lesson match a source, but the range doesn't
//   unknown_source   no source has that module + lesson
//
// A compound citation lists several ranges for one lesson ("at 02:11 – 02:51,
// 02:53 – 03:37, and 03:37 – 04:19"). Each range becomes its own citation and
// is verified on its own; all of them carry the full compound text.

const TS = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const RANGE = String.raw`${TS}(?:\s*(?:–|—|-|to)\s*${TS})?`;
const LIST_SEP = String.raw`(?:\s*[,;]\s*(?:and\s+)?|\s+and\s+)(?:at\s+)?`;
const CITATION_RE = new RegExp(
  String.raw`(Module\s+\d+(?:\s+hc)?)\s*,\s*Lesson:\s*([^()\n]+?)\s*,\s*at\s+(${RANGE}(?:${LIST_SEP}${RANGE})*)`,
  "gi"
);
const RANGE_RE = new RegExp(String.raw`(${TS})(?:\s*(?:–|—|-|to)\s*(${TS}))?`, "g");
const TOLERANCE_S = 1; // displayed timestamps are floored to whole seconds

function tsToSeconds(ts) {
  return ts.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function extractCitations(answer) {
  return [...answer.matchAll(CITATION_RE)].flatMap((m) =>
    [...m[3].matchAll(RANGE_RE)].map((r) => ({
      text: m[0],
      module: m[1],
      lesson: m[2],
      start: tsToSeconds(r[1]),
      end: tsToSeconds(r[2] || r[1]),
    }))
  );
}

// sources: [{ module, lesson, start, end }] with start/end in seconds.
function verifyCitations(answer, sources) {
  const citations = extractCitations(answer).map((c) => {
    const sameLesson = sources.filter(
      (s) => norm(s.module) === norm(c.module) && norm(s.lesson) === norm(c.lesson)
    );
    const inRange = sameLesson.some(
      (s) => c.start >= Math.floor(s.start) - TOLERANCE_S && c.end <= s.end + TOLERANCE_S
    );
    const status = inRange ? "verified" : sameLesson.length ? "wrong_timestamp" : "unknown_source";
    return { ...c, status };
  });
  return {
    total: citations.length,
    verified: citations.filter((c) => c.status === "verified").length,
    citations,
  };
}

module.exports = { extractCitations, verifyCitations };
