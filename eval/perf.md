Model: `gemini-3.1-flash-lite`. Measured on 2026-09-16 from 28 runs (10 questions x 3 repeats), against the live Qdrant index.

Unlike the retrieval tables, these numbers cannot be replayed from the committed cache: a cached response returns in microseconds, so every call behind this table was a real one. Re-running `npm run perf` spends quota and will produce slightly different times.

**Per stage**

| Stage | Runs | Median | p95 | Input tokens per question | Output tokens per question | Cost per question |
|---|---|---|---|---|---|---|
| HyDE passage (LLM) | 28 | 1.22 s | 1.88 s | 115 | 95 | $0.000171 |
| Answer generation (LLM) | 28 | 1.22 s | 3.02 s | 913 | 138 | $0.000435 |
| Rerank (LLM) | 28 | 1.05 s | 1.65 s | 1032 | 7 | $0.000269 |
| Condensation (LLM) | 6 | 1.01 s | 1.93 s | 33 | 4 | $0.000014 |
| Vector search (Qdrant, x2) | 28 | 977 ms | 1.48 s | - | - | free |
| Guardrail (LLM) | 28 | 936 ms | 1.93 s | 386 | 1 | $0.000098 |
| Embed the HyDE passage (local) | 28 | 28 ms | 34 ms | - | - | free |
| Embed the question (local) | 28 | 11 ms | 18 ms | - | - | free |
| Verify citations (local) | 28 | 0 ms | 1 ms | - | - | free |

**End to end**

| Measure | Value |
|---|---|
| Median wait for an answer | 5.75 s |
| p95 wait (slowest of 28 runs is 10.09 s) | 9.97 s |
| Median wait, single-turn questions (22 runs) | 5.65 s |
| Median wait, follow-up questions (6 runs) | 6.76 s |
| Median summed stage time | 6.00 s |
| Cost per question | $0.000987 |
| Questions per US dollar | 1,013 |

The summed stage time is larger than the wall clock because stages overlap: the question embed and the HyDE call run concurrently, and so do the two vector searches.

Cost uses Gemini's published paid rates for `gemini-3.1-flash-lite`, $0.25 per million input tokens and $1.50 per million output tokens, checked on 2026-09-16. Actual spend is zero on the free tier.

p95 here is the nearest-rank value over 28 runs, which makes it the 2nd slowest observation rather than a smooth estimate. Treat it as an indication, not a guarantee.

These times are warm. The embedding model is loaded before any measurement starts (191 ms here) and one throwaway API call establishes the connection (733 ms, most of it DNS and TLS). A cold start on a sleeping free-tier server pays both of those again, and pays them on the first stage that runs.

2 of 30 runs were excluded: c09 repeat 1 (HTTP 429), c05 repeat 2 (HTTP 503).

**Per question** (median wall clock over the repeats)

| Question | Turns | Median | Calls | Answer chars | Citations |
|---|---|---|---|---|---|
| c01 | single | 6.10 s | 4 | 632 | 3 |
| c05 | single | 4.41 s | 4 | 322 | 1 |
| c09 | single | 5.11 s | 4 | 683 | 2.5 |
| c13 | single | 5.70 s | 4 | 1231 | 4 |
| p02 | single | 4.69 s | 4 | 462 | 2 |
| p07 | single | 6.24 s | 4 | 293 | 1 |
| p13 | single | 5.62 s | 4 | 194 | 1 |
| p19 | single | 7.26 s | 4 | 1071 | 5 |
| m01 | follow-up | 6.38 s | 5 | 185 | 1 |
| m05 | follow-up | 8.20 s | 5 | 409 | 2 |
