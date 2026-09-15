# LectureLens

Answers student questions about a Udemy course's video content, citing the
exact module, lesson, and timestamp where the topic was taught.

## Architecture

```
SRT/VTT files → parse → chunk (with timestamps) → embed (local, all-MiniLM-L6-v2) → Qdrant
                                                                                        ↓
user question → input guardrail (history-aware) → query condensation (multi-turn)
              → embed + HyDE → retrieve (up to 10 candidates) → LLM rerank → up to 5
              → answer generation (cited, history-aware)
```

Pipeline stages, mapped to the original reference diagram:

| Stage | Diagram equivalent | Status |
|---|---|---|
| Chunking + embedding | Data ingestion | Done (local embeddings, no rate limits) |
| Input guardrail | Guardrails / PII detection | Done: strict scope classifier (course and mobile app development only), history-aware |
| Query condensation | (multi-turn extension, not in original diagram) | Done: resolves follow-ups like "what about on iOS?" |
| HyDE | HyDE | Done: bridges spoken-lecture phrasing vs. formal questions |
| Reranking | RANK | Done: LLM reranks merged candidates before final selection |
| Query routing (SQL/vector/S3) | Query Routing | **Not applicable**: single course, single vector store, nothing to route between |
| Step-back / query decomposition | More Abstraction / Decompose | Not implemented. Step-back skipped because HyDE and condensation cover similar ground; decomposition is listed under Future scope |

## Setup

1. **Gemini API key** (free): https://aistudio.google.com/apikey (used only
   for guardrail/condense/HyDE/rerank/answer LLM calls, not embeddings).
2. **Qdrant Cloud free cluster**: https://cloud.qdrant.io
3. Backend:
   ```
   npm install
   cp .env.example .env
   # fill in GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY
   ```
4. Frontend:
   ```
   cd frontend
   npm install
   ```

## Ingest your course

```
npm run ingest -- "/path/to/class-subtitle"
```

Walks `module N/lesson-folder/*.srt|.vtt`, chunks (~45s per chunk), embeds
locally (no API, no rate limits), upserts to Qdrant. Re-run after any change
to `cleanLessonTitle`/`cleanModuleName` in `src/ingest.js`, and delete the
Qdrant collection first so old and new casing don't mix.

## Run it

```
npm start                      # backend on :3001
cd frontend && npm run dev     # frontend on :5173
```

## Evaluation

Retrieval here is measured, not asserted. `eval/questions.json` holds 55
questions. 50 are labeled with the module, lesson, and timestamp window that
actually answers each one. The other 5 ask about things the course never
teaches, to check that the bot says so instead of improvising. `npm run eval`
runs every labeled question through the same `retrieve()` function the server
uses, with pipeline stages switched on one at a time, against the live Qdrant
index.

Reproduce the published numbers without spending any API quota:

```
npm run eval -- --cache-only
```

Every Gemini response is cached in `eval/cache/llm.json`, which is committed,
so a cache-only run replays the exact calls behind the tables below. A run
that hits any API error refuses to write results at all, so a partially failed
run cannot quietly turn into a published number.

A retrieved chunk counts as a hit only if it comes from the labeled lesson and
overlaps the labeled time window by at least one second. Lesson hit is the
looser version of the same measure, right lesson at any timestamp, so it counts
every strict hit plus the near misses and is always the larger number.

The `k` in the table headers is not always 5. The reranker is told to drop
excerpts it judges irrelevant rather than pad the list out, so the reranked
rows return at most 5 results and usually fewer: a mean of 3.1 in the
production configuration, with 8 of the 38 single-turn questions answered from
a single excerpt. A shorter list can only lose hits, never gain them, so this
handicaps those rows rather than flattering them. The candidate pool is 10
except on the HyDE rows, where the raw and hypothetical-answer searches
sometimes return the same chunk and dedup to 9 (mean 9.8).

**Single-turn questions**

| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |
|---|---|---|---|---|---|---|---|
| Vector search only | 38 | 5.0 | 39% | 61% (23/38) | 0.482 | 87% | 68% |
| + HyDE | 38 | 5.0 | 45% | 63% (24/38) | 0.526 | 87% | 74% |
| + Rerank (no HyDE) | 38 | 3.2 | 63% | 68% (26/38) | 0.658 | 87% | 68% |
| + HyDE + Rerank (production) | 38 | 3.1 | 66% | 71% (27/38) | 0.684 | 87% | 74% |

**Multi-turn follow-ups** (every row runs HyDE and rerank; only the handling
of conversation history changes)

| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |
|---|---|---|---|---|---|---|---|
| Follow-up alone (no condensation) | 12 | 2.6 | 50% | 67% (8/12) | 0.563 | 83% | 67% |
| Previous turn + follow-up, concatenated | 12 | 3.8 | 8% | 67% (8/12) | 0.354 | 83% | 67% |
| LLM condensation (production) | 12 | 2.5 | 75% | 83% (10/12) | 0.792 | 92% | 92% |

**Citation accuracy**, measured on full production answers to all 55
questions: 104 of 105 parsed citations verified (99%). The one failure cited a
single 19-minute range (00:00 to 19:26), which no retrieved excerpt spans. No
answer cited a lesson that was not among its excerpts. Verification confirms
that a cited location was among the excerpts, not that the passage supports the
claim: three of the verified citations belong to the not-covered answer about
a recording's file path, described below. Four answers carried no citation: three were correct declines
to questions the course doesn't cover, and the fourth declined a question the
course does answer, because rerank dropped the labeled passage from the
candidates. Four answers also wrote compound citations naming several time
ranges for one lesson, one of them listing three. The parser splits these and
checks each range as its own citation, so 105 counts ranges rather than
parentheticals, and no timestamp in any answer falls outside a checked
citation.

**Questions the course does not cover**: 4 of 5 production answers said the
course doesn't cover the topic. That count comes from a keyword check, and
every answer was also read by hand, which agrees. The failure is instructive:
asked how to get a recorded clip's file path, the answer took a remark that
saving recordings needs a development build and joined it to image-saving code
from a different module, producing a cited answer the course never gives. Five
questions is a spot check, not a rate.

### What the numbers actually say

- **Reranking cannot fix retrieval, only ordering.** It picks from the pool
  vector search already produced, so its hit@k can never exceed that pool's
  recall. Rerank alone lifted hit@k from 61% to 68% by pulling three answers up
  from ranks 6 to 10, which is exactly the pool's recall@10 of 68%: it found
  everything there was to find. Its larger effect is order, hit@1 39% to 63%
  and MRR 0.482 to 0.658.
- **HyDE is the stage that changes what gets found at all.** It lifts pool
  recall@10 from 68% to 74% (74% to 79% across 4 draws), because a
  hypothetical instructor-voice answer matches spoken transcript phrasing
  better than a student's question does. On its own it is noisy at hit@k: 3
  questions newly hit, 2 newly missed, and 4 questions flip between draws.
- **The two compose.** HyDE widens the pool, rerank then picks better inside
  it: hit@1 39% to 66%, MRR 0.482 to 0.684.
- **Condensation is what makes follow-ups work.** Concatenating the previous
  turn drags the earlier topic's vocabulary into the query and wrecks hit@1
  (8%). Rewriting the follow-up into a standalone question first lifts hit@1
  to 75% and pool recall from 67% to 92%.

### Caveats

Read these before quoting any number above.

- **n is still small.** 38 single-turn and 12 multi-turn questions. One
  question is worth about 3 percentage points on single-turn and 8 on
  multi-turn, so a gap of one or two questions is noise. The per-question win
  and loss table in `eval/results.md` is more informative than the headline
  percentages.
- **HyDE runs at temperature 0.4, so its rows move between runs.** The
  tables above are one draw. Across 4 independent HyDE draws the production
  row scored hit@k 71% to 76% (mean 73%), hit@1 61% to 71%, and MRR 0.658 to
  0.728, with 6 of 38 questions switching between hit and miss. Pool
  recall@10 on both HyDE rows ranged 74% to 79%. The published draw sits at
  the low end for hit@k and pool recall, so it does not flatter HyDE, but
  its "+ HyDE" hit@1 of 45% is the highest of the 4 draws (range 32% to
  45%). The full spread is in `eval/results.md`.
- **Question provenance matters.** 16 single-turn and 7 multi-turn questions
  were generated and are marked `"author": "generated"`. The rest were written
  by hand, before reading any transcript, and are marked `"author": "preet"`.
  Generated questions share vocabulary with the corpus they were written from,
  which flatters retrieval. In the production configuration the hand-written
  single-turn questions hit 15 of 22 (68%) against 12 of 16 (75%) for the
  generated ones, and on follow-ups 3 of 5 against 7 of 7. The hand-written
  subset is the more honest signal, and it is now the larger one.
- **One follow-up was rewritten after reading the transcripts.** The original
  second turn of one hand-written thread duplicated an existing question, so
  its replacement is marked generated and carries a note. The assistant turns
  in every thread's history are short written summaries, not real production
  answers.
- **Two labels include a location that retrieval found first.** For the
  questions about saving a downloaded image and about a loading spinner, a
  production run returned a second valid passage the first labeling missed.
  Both were confirmed against the transcript and added, and both questions hit
  only through that second location. Without them production hit@k would be
  25 of 38 (66%). Labels can be incomplete the other way too: the spinner
  question's top result is a third valid passage that is not labeled.
- **Six of the eleven production misses land in the right lesson** but
  outside the labeled window, so a student would still have been sent to the
  right video, just not the right minute. The other five miss the lesson.
- **Four of those six are boundary misses.** A hit needs at least one second
  of overlap with the labeled window, and in those four cases the retrieved
  chunk ends exactly where the labeled window starts, or starts exactly where
  it ends: retrieval landed on the immediately adjacent chunk. The strict rule
  is worth keeping, since a student sent 40 seconds early is still sent to the
  wrong place, but it does mean the headline numbers are a floor rather than a
  generous reading.
- **One label is weaker than the rest.** The question about keeping a settings
  screen outside a tab layout is answered only implicitly by the course, which
  states that files inside the tabs directory become tabs but never addresses
  the symptom. It is labeled against that statement, and the production
  pipeline misses it.

### Guardrail

The input guardrail is deliberately strict. It answers questions about the
course and about building mobile apps with React Native and Expo, and nothing
else. Small talk, unrelated requests, prompt injection, and general web
development or database questions with no mobile angle ("how do I center a div
in CSS?", "explain SQL joins") get a refusal before retrieval runs. The same
topics asked about a mobile app still get answered ("in CSS I'd use flexbox,
how do I center a View in React Native?", "how do I insert rows with SQLite in
my Expo app?").

`npm run eval:guardrail` runs the production `checkGuardrail()` over every
eval question plus the hand-written cases in `eval/guardrail-cases.json`, using
the retrieval eval's committed response cache, so `-- --cache-only` reproduces
it for free.

| Set | Result |
|---|---|
| On-topic questions: all 55 eval questions, plus 16 hand-written phrasings (web-framed, SQLite, API routes, and course topics that name no app at all, such as the Better Auth server or TypeScript generics) | 71 of 71 allowed |
| Off-topic messages: 8 unrelated requests, 2 prompt injections, 1 follow-up that drifts off topic, 9 general web and database questions | 20 of 20 rejected |

Before the web and database rule was added, the guardrail allowed 3 of the
first 6 web and database questions. Three caveats. These counts are a smoke
test, not measured rates: 20 rejects cannot estimate how often off-topic
messages slip through, and most of the 71 allowed questions name React Native
or Expo, so they say little about how often borderline course questions get
refused. The borderline cases exist to catch that, but there are only five.
And the guardrail fails open: if the Gemini call errors, the message goes on to
retrieval instead of being blocked.

## Deployment

### Backend (Render)

Set these environment variables in your [Render](https://render.com) dashboard:

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Gemini API key |
| `QDRANT_URL` | Qdrant cluster URL |
| `QDRANT_API_KEY` | Qdrant API key |
| `QDRANT_COLLECTION` | Qdrant collection name |
| `FRONTEND_URL` | Your Vercel frontend URL (no trailing slash) |

Set the build command to `npm install && npm run build`. The build step
downloads the embedding model, because Render's runtime disk is wiped on
every spin-down and the model would otherwise be re-fetched on each cold
start. The free tier still sleeps when idle; the frontend pings `/health` on
load and shows a "waking up" banner while that happens.

### Keeping the Qdrant free cluster alive

Qdrant Cloud suspends free clusters after a week without use and deletes
them after four. `.github/workflows/qdrant-keepalive.yml` reads one point
every 3 days and fails (triggering a GitHub email) if the cluster is gone.
Add `QDRANT_URL` and `QDRANT_API_KEY` as repository secrets. GitHub pauses
scheduled workflows after 60 days without repository activity, so check the
Actions tab if the repo goes quiet for that long.

### Frontend (Vercel)

Set `VITE_API_URL` to your Render backend URL in the [Vercel](https://vercel.com) project settings (Environment Variables).

## Screenshots

![Demo](screenshots/demo-1.png)

## Known limitations (deliberate scope decisions, not oversights)

- **Single course only.** Query routing across multiple courses/data sources
  is architecturally not needed here, since there's one vector store. See Future
  Scope below for what multi-course support would require.
- **Guardrail is a single classifier call**, not the full PII/competitor
  detection pipeline from the reference diagram. That's appropriate for a
  single-course student support bot.
- **Chat history is per-browser** (`localStorage`), not synced across
  devices or persisted server-side.

## Future scope: turning this from a project into a product

Ranked roughly by effort-to-value if this continues past the assignment:

1. **Multi-course support with real query routing.** Add a course selector,
   tag every chunk with a `course_id`, and route retrieval to the right
   course's data. This is where the "Query Routing" diagram node actually
   becomes applicable, unlike now.
2. **Analytics / instructor dashboard.** Log every question, its condensed
   query, retrieval scores, and whether the guardrail blocked it, to a small
   database (SQLite is enough to start). Surface: most-asked topics, questions
   with weak retrieval scores (signals a content gap or confusing lesson),
   and blocked/off-topic queries. Needs real usage data to be convincing, so
   don't ship an empty dashboard.
3. **Course outline sidebar.** Let students browse modules/lessons directly
   instead of only asking questions. Useful for students who don't know
   what to ask yet.
4. **Query decomposition for compound questions** ("explain OAuth and push
   notifications"): split into sub-questions, retrieve for each, merge.
5. **Streaming answers.** Stream the LLM response token-by-token to the UI
   instead of waiting for the full answer. Meaningful perceived-speed
   improvement, no architecture change needed.
6. **Feedback loop.** Thumbs up/down on answers, stored alongside the
   analytics log. Lets you distinguish "low retrieval score but actually a
   fine answer" from "high score but wrong answer."
7. **Server-side chat history + accounts.** Move history off `localStorage`
   so it syncs across devices; needed if this ever has real multiple users.
8. **Faithfulness/hallucination check.** A second LLM pass verifying the
   final answer's claims are actually supported by the cited excerpts, before
   returning it. Real value, but needs careful testing to avoid false
   rejections of good answers.
9. **Video timestamp deep-linking.** If lesson videos are hosted somewhere
   with seek-to-timestamp URLs (e.g. an internal LMS), turn the citation
   timestamps into clickable links that jump straight to that second.