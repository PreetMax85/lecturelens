Candidate pools from the 38 single-turn questions in eval/questions.json, the same pools and LLM rerank orders as eval/results.md (checked against every per-question retrieval field in eval/results.json). 0 Gemini calls: the LLM rows replay eval/cache/llm.json.

One question moves a hit rate by 2.6 points. The head-to-head tables list the questions behind each gap and give p, an exact two-sided sign test on the questions where the two rerankers disagree. The arms are not independent tests, so read p per arm, not as a family.

The LLM order is one cached temperature-0 response per pool and the HyDE pool is one draw, so neither side's sampling variance is measured.

Arms:

- **LLM's k**: the cross-encoder list cut to the number of results the LLM reranker returned for that question. Same list length as the LLM row, so this is the like-for-like comparison.
- **top 5**: the production FINAL_K. The LLM reranker drops excerpts it judges irrelevant, so this arm returns more results than the LLM row and hit@k favours it. Hit@1 does not depend on k.
- **text** / **header + text**: what the cross-encoder scores. The LLM reranker sees `[module | lesson | timestamp]` and the first 300 characters of each chunk, so the header input gives the cross-encoder the same lesson titles (with the full chunk text).
  The header input was added after a first run scored text only, to rule out the lesson titles as the reason the LLM wins. It is an input choice, not a tuned parameter.

**Without HyDE**

| Reranker | Avg k | Hit@1 | Hit@k | MRR@k | Pool recall@10 | Rerank latency, median / p95 | Cost per question |
|---|---|---|---|---|---|---|---|
| No rerank (vector order, top 5) | 5.0 | 39% | 61% (23/38) | 0.482 | 68% | none | $0 |
| LLM rerank (gemini-3.1-flash-lite, production) | 3.2 | 63% | 68% (26/38) | 0.658 | 68% | 1.05 s / 1.65 s | $0.000269 |
| MiniLM-L-6 (ms-marco), text, LLM's k | 3.2 | 42% | 58% (22/38) | 0.500 | 68% | 103 ms / 129 ms | $0 (local CPU) |
| MiniLM-L-6 (ms-marco), text, top 5 | 5.0 | 42% | 63% (24/38) | 0.515 | 68% | 103 ms / 129 ms | $0 (local CPU) |
| MiniLM-L-6 (ms-marco), header + text, LLM's k | 3.2 | 47% | 63% (24/38) | 0.548 | 68% | 122 ms / 152 ms | $0 (local CPU) |
| MiniLM-L-6 (ms-marco), header + text, top 5 | 5.0 | 47% | 66% (25/38) | 0.557 | 68% | 122 ms / 152 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, text, LLM's k | 3.2 | 39% | 55% (21/38) | 0.458 | 68% | 458 ms / 554 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, text, top 5 | 5.0 | 39% | 63% (24/38) | 0.482 | 68% | 458 ms / 554 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, header + text, LLM's k | 3.2 | 39% | 61% (23/38) | 0.493 | 68% | 533 ms / 610 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, header + text, top 5 | 5.0 | 39% | 66% (25/38) | 0.507 | 68% | 533 ms / 610 ms | $0 (local CPU) |

Head-to-head against the LLM reranker (questions a cross-encoder arm gets that the LLM does not, and the reverse):

| Arm | Hit@1 wins | Hit@1 losses | Hit@1 p | Hit@k wins | Hit@k losses | Hit@k p |
|---|---|---|---|---|---|---|
| MiniLM-L-6 (ms-marco), text, LLM's k | 2 (c07, c16) | 10 (p02, p08, p10, p11, p13, p14, p16, p18, p19, p21) | 0.04 | 0 | 4 (p02, p13, p16, p18) | 0.13 |
| MiniLM-L-6 (ms-marco), text, top 5 | 2 (c07, c16) | 10 (p02, p08, p10, p11, p13, p14, p16, p18, p19, p21) | 0.04 | 0 | 2 (p02, p18) | 0.50 |
| MiniLM-L-6 (ms-marco), header + text, LLM's k | 2 (c07, c16) | 8 (p02, p03, p08, p10, p11, p14, p18, p19) | 0.11 | 0 | 2 (p02, p18) | 0.50 |
| MiniLM-L-6 (ms-marco), header + text, top 5 | 2 (c07, c16) | 8 (p02, p03, p08, p10, p11, p14, p18, p19) | 0.11 | 0 | 1 (p18) | 1.00 |
| mxbai-rerank-xsmall, text, LLM's k | 1 (c07) | 10 (c05, c09, p02, p05, p11, p14, p16, p18, p19, p21) | 0.01 | 0 | 5 (c05, p02, p05, p16, p18) | 0.06 |
| mxbai-rerank-xsmall, text, top 5 | 1 (c07) | 10 (c05, c09, p02, p05, p11, p14, p16, p18, p19, p21) | 0.01 | 0 | 2 (p05, p16) | 0.50 |
| mxbai-rerank-xsmall, header + text, LLM's k | 1 (c07) | 10 (c05, c09, p02, p05, p08, p11, p14, p16, p18, p19) | 0.01 | 0 | 3 (p02, p05, p16) | 0.25 |
| mxbai-rerank-xsmall, header + text, top 5 | 1 (c07) | 10 (c05, c09, p02, p05, p08, p11, p14, p16, p18, p19) | 0.01 | 0 | 1 (p05) | 1.00 |

**With HyDE, draw 1 (production pool)**

| Reranker | Avg k | Hit@1 | Hit@k | MRR@k | Pool recall@10 | Rerank latency, median / p95 | Cost per question |
|---|---|---|---|---|---|---|---|
| No rerank (vector order, top 5) | 5.0 | 45% | 63% (24/38) | 0.526 | 74% | none | $0 |
| LLM rerank (gemini-3.1-flash-lite, production) | 3.1 | 66% | 71% (27/38) | 0.684 | 74% | 1.05 s / 1.65 s | $0.000269 |
| MiniLM-L-6 (ms-marco), text, LLM's k | 3.1 | 45% | 55% (21/38) | 0.496 | 74% | 103 ms / 129 ms | $0 (local CPU) |
| MiniLM-L-6 (ms-marco), text, top 5 | 5.0 | 45% | 63% (24/38) | 0.518 | 74% | 103 ms / 129 ms | $0 (local CPU) |
| MiniLM-L-6 (ms-marco), header + text, LLM's k | 3.1 | 50% | 63% (24/38) | 0.566 | 74% | 122 ms / 152 ms | $0 (local CPU) |
| MiniLM-L-6 (ms-marco), header + text, top 5 | 5.0 | 50% | 66% (25/38) | 0.579 | 74% | 122 ms / 152 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, text, LLM's k | 3.1 | 37% | 53% (20/38) | 0.439 | 74% | 458 ms / 554 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, text, top 5 | 5.0 | 37% | 66% (25/38) | 0.471 | 74% | 458 ms / 554 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, header + text, LLM's k | 3.1 | 34% | 58% (22/38) | 0.456 | 74% | 533 ms / 610 ms | $0 (local CPU) |
| mxbai-rerank-xsmall, header + text, top 5 | 5.0 | 34% | 68% (26/38) | 0.492 | 74% | 533 ms / 610 ms | $0 (local CPU) |

Head-to-head against the LLM reranker (questions a cross-encoder arm gets that the LLM does not, and the reverse):

| Arm | Hit@1 wins | Hit@1 losses | Hit@1 p | Hit@k wins | Hit@k losses | Hit@k p |
|---|---|---|---|---|---|---|
| MiniLM-L-6 (ms-marco), text, LLM's k | 2 (c07, c16) | 10 (c04, c06, c10, p02, p06, p08, p11, p14, p16, p18) | 0.04 | 1 (c07) | 7 (c04, c06, c10, p02, p13, p16, p18) | 0.07 |
| MiniLM-L-6 (ms-marco), text, top 5 | 2 (c07, c16) | 10 (c04, c06, c10, p02, p06, p08, p11, p14, p16, p18) | 0.04 | 1 (c07) | 4 (c04, c06, p02, p18) | 0.38 |
| MiniLM-L-6 (ms-marco), header + text, LLM's k | 3 (c07, c16, p13) | 9 (c04, c06, p02, p03, p06, p08, p11, p14, p18) | 0.15 | 1 (c07) | 4 (c04, c06, p02, p18) | 0.38 |
| MiniLM-L-6 (ms-marco), header + text, top 5 | 3 (c07, c16, p13) | 9 (c04, c06, p02, p03, p06, p08, p11, p14, p18) | 0.15 | 1 (c07) | 3 (c04, c06, p18) | 0.63 |
| mxbai-rerank-xsmall, text, LLM's k | 2 (c07, p13) | 13 (c04, c05, c06, c09, c10, p02, p05, p06, p11, p14, p16, p18, p19) | < 0.01 | 1 (c07) | 8 (c04, c05, c06, c10, p02, p05, p16, p18) | 0.04 |
| mxbai-rerank-xsmall, text, top 5 | 2 (c07, p13) | 13 (c04, c05, c06, c09, c10, p02, p05, p06, p11, p14, p16, p18, p19) | < 0.01 | 1 (c07) | 3 (c04, p05, p16) | 0.63 |
| mxbai-rerank-xsmall, header + text, LLM's k | 2 (c07, p13) | 14 (c04, c05, c06, c09, c10, p02, p05, p06, p08, p11, p14, p16, p18, p19) | < 0.01 | 1 (c07) | 6 (c04, c05, c06, p02, p05, p18) | 0.13 |
| mxbai-rerank-xsmall, header + text, top 5 | 2 (c07, p13) | 14 (c04, c05, c06, c09, c10, p02, p05, p06, p08, p11, p14, p16, p18, p19) | < 0.01 | 1 (c07) | 2 (c04, p05) | 1.00 |

**Latency method**

Cross-encoder rows: fp32 weights on CPU, one batch per pool, timed after a warm-up over 3 passes of every pool (228 samples per reranker and input). Machine: AMD Ryzen 7 6800H with Radeon Graphics, 16 threads, Node v24.11.0. These are laptop numbers, not the deployed host, and they exclude the one-off model load (MiniLM-L-6 (ms-marco) 343 ms, mxbai-rerank-xsmall 1.64 s on this run, from the local cache). Cost is zero API spend; the cost is CPU time and memory on the server.

LLM rows: the rerank stage from eval/perf.json (28 real production runs, gemini-3.1-flash-lite, network round trip included), not re-measured here. Cost at the paid rates listed in eval/perf.md.
