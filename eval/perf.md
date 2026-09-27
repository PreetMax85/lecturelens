Model: `gemini-3.1-flash-lite`. Measured on 2026-09-27 from 29 runs (10 questions x 3 repeats), against the live Qdrant index.

Unlike the retrieval tables, these numbers cannot be replayed from the committed cache: a cached response returns in microseconds, so every call behind this table was a real one. Re-running `npm run perf` spends quota and will produce slightly different times.

**Per stage**

| Stage | Runs | Median | p95 | Input tokens per question | Output tokens per question | Cost per question |
|---|---|---|---|---|---|---|
| Answer generation (LLM) | 29 | 2.84 s | 8.83 s | 882 | 134 | $0.000421 |
| Condensation (LLM) | 6 | 2.46 s | 3.64 s | 32 | 4 | $0.000014 |
| HyDE passage (LLM) | 29 | 2.11 s | 6.49 s | 115 | 95 | $0.000171 |
| Vector search (Qdrant, x2) | 29 | 1.29 s | 1.81 s | - | - | free |
| Guardrail (LLM, alongside retrieval) | 29 | 1.22 s | 6.16 s | 386 | 1 | $0.000098 |
| Rerank (LLM) | 29 | 1.20 s | 6.61 s | 1031 | 7 | $0.000269 |
| Embed the HyDE passage (local) | 29 | 19 ms | 32 ms | - | - | free |
| Embed the question (local) | 29 | 10 ms | 14 ms | - | - | free |
| Verify citations (local) | 29 | 0 ms | 1 ms | - | - | free |

**End to end**

| Measure | Value |
|---|---|
| Median wait for the first words of the answer (29 runs) | 7.15 s |
| p95 wait for the first words | 18.01 s |
| Median wait for the whole answer | 7.85 s |
| p95 wait for the whole answer (slowest of 29 runs is 19.47 s) | 19.44 s |
| Median wait for the whole answer, single-turn questions (23 runs) | 7.50 s |
| Median wait for the whole answer, follow-up questions (6 runs) | 10.66 s |
| Median summed stage time | 11.11 s |
| Cost per question | $0.000974 |
| Questions per US dollar | 1,027 |

The summed stage time is larger than the wall clock because stages overlap: the guardrail runs alongside condensation, HyDE and search, the question embed and the HyDE call run concurrently, and so do the two vector searches. The answer is streamed: the first words arrive once its call starts writing, and the whole-answer wait ends when the last of it has arrived and its citations are checked.

Cost uses Gemini's published paid rates for `gemini-3.1-flash-lite`, $0.25 per million input tokens and $1.50 per million output tokens, checked on 2026-09-16. Actual spend is zero on the free tier.

p95 here is the nearest-rank value over 29 runs, which makes it the 2nd slowest observation rather than a smooth estimate. Treat it as an indication, not a guarantee.

These times are warm. The embedding model is loaded before any measurement starts (162 ms here) and one throwaway API call establishes the connection (1.41 s, most of it DNS and TLS). A cold start on a sleeping free-tier server pays both of those again, and pays them on the first stage that runs.

1 of 30 runs were excluded: c09 repeat 1 (HTTP 429).

**Per question** (medians over the repeats)

| Question | Turns | First words | Whole answer | Calls | Answer chars | Citations |
|---|---|---|---|---|---|---|
| c01 | single | 6.10 s | 7.48 s | 4 | 613 | 3 |
| c05 | single | 4.76 s | 5.50 s | 4 | 322 | 1 |
| c09 | single | 9.80 s | 11.93 s | 4 | 999 | 4 |
| c13 | single | 5.00 s | 7.50 s | 4 | 1104 | 4 |
| p02 | single | 11.12 s | 12.33 s | 4 | 558 | 2 |
| p07 | single | 15.76 s | 16.31 s | 4 | 478 | 2 |
| p13 | single | 5.07 s | 5.38 s | 4 | 161 | 1 |
| p19 | single | 12.06 s | 13.84 s | 4 | 834 | 3 |
| m01 | follow-up | 9.04 s | 9.61 s | 5 | 232 | 1 |
| m05 | follow-up | 12.87 s | 13.66 s | 5 | 217 | 1 |
