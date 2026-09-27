Model: `gemini-3.1-flash-lite`. Measured on 2026-09-27 from 29 runs (10 questions x 3 repeats), against the live Qdrant index.

Unlike the retrieval tables, these numbers cannot be replayed from the committed cache: a cached response returns in microseconds, so every call behind this table was a real one. Re-running `npm run perf` spends quota and will produce slightly different times.

**Per stage**

| Stage | Runs | Median | p95 | Input tokens per question | Output tokens per question | Cost per question |
|---|---|---|---|---|---|---|
| Condensation (LLM) | 5 | 1.97 s | 2.16 s | 27 | 3 | $0.000011 |
| HyDE passage (LLM) | 29 | 1.64 s | 7.73 s | 115 | 92 | $0.000167 |
| Answer generation (LLM) | 29 | 1.52 s | 5.81 s | 932 | 141 | $0.000445 |
| Vector search (Qdrant, x2) | 29 | 1.50 s | 2.63 s | - | - | free |
| Guardrail (LLM) | 29 | 1.20 s | 5.48 s | 385 | 1 | $0.000098 |
| Rerank (LLM) | 29 | 994 ms | 4.56 s | 1037 | 7 | $0.000271 |
| Embed the HyDE passage (local) | 29 | 25 ms | 33 ms | - | - | free |
| Embed the question (local) | 29 | 10 ms | 16 ms | - | - | free |
| Verify citations (local) | 29 | 0 ms | 1 ms | - | - | free |

**End to end**

| Measure | Value |
|---|---|
| Median wait for an answer | 7.48 s |
| p95 wait (slowest of 29 runs is 20.63 s) | 17.80 s |
| Median wait, single-turn questions (24 runs) | 7.41 s |
| Median wait, follow-up questions (5 runs) | 7.79 s |
| Median summed stage time | 8.24 s |
| Cost per question | $0.000992 |
| Questions per US dollar | 1,008 |

The summed stage time is larger than the wall clock because stages overlap: the question embed and the HyDE call run concurrently, and so do the two vector searches.

Cost uses Gemini's published paid rates for `gemini-3.1-flash-lite`, $0.25 per million input tokens and $1.50 per million output tokens, checked on 2026-09-16. Actual spend is zero on the free tier.

p95 here is the nearest-rank value over 29 runs, which makes it the 2nd slowest observation rather than a smooth estimate. Treat it as an indication, not a guarantee.

These times are warm. The embedding model is loaded before any measurement starts (156 ms here) and one throwaway API call establishes the connection (799 ms, most of it DNS and TLS). A cold start on a sleeping free-tier server pays both of those again, and pays them on the first stage that runs.

1 of 30 runs were excluded: m01 repeat 1 (network error).

**Per question** (median wall clock over the repeats)

| Question | Turns | Median | Calls | Answer chars | Citations |
|---|---|---|---|---|---|
| c01 | single | 7.08 s | 4 | 604 | 3 |
| c05 | single | 7.48 s | 4 | 322 | 1 |
| c09 | single | 10.28 s | 4 | 781 | 3 |
| c13 | single | 10.41 s | 4 | 1167 | 4 |
| p02 | single | 6.30 s | 4 | 533 | 2 |
| p07 | single | 6.76 s | 4 | 300 | 1 |
| p13 | single | 6.19 s | 4 | 194 | 1 |
| p19 | single | 6.09 s | 4 | 942 | 4 |
| m01 | follow-up | 10.75 s | 5 | 200 | 1 |
| m05 | follow-up | 7.79 s | 5 | 300 | 1 |
