Model: `gemini-3.1-flash-lite`. Index: 1955 chunks. Rerank responses that failed to parse (fell back to vector order): 0.

`k` is the number of results the configuration actually returned, shown in the Avg results column. It is 5 on the rows without rerank. The reranker drops excerpts it judges irrelevant instead of padding the list, so on the reranked rows it is at most 5 and usually fewer. A shorter list can only lose hits, never gain them.

**Single-turn questions**

| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |
|---|---|---|---|---|---|---|---|
| Vector search only | 24 | 5.0 | 46% | 63% (15/24) | 0.524 | 88% | 63% |
| + HyDE | 24 | 5.0 | 46% | 67% (16/24) | 0.549 | 92% | 75% |
| + Rerank (no HyDE) | 24 | 3.2 | 54% | 63% (15/24) | 0.583 | 88% | 63% |
| + HyDE + Rerank (production) | 24 | 3.3 | 67% | 71% (17/24) | 0.688 | 88% | 75% |

**Multi-turn follow-ups** (all rows use HyDE + rerank)

| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |
|---|---|---|---|---|---|---|---|
| Follow-up alone (no condensation) | 6 | 2.7 | 50% | 50% (3/6) | 0.500 | 67% | 50% |
| Previous turn + follow-up, concatenated | 6 | 3.8 | 17% | 67% (4/6) | 0.375 | 83% | 67% |
| LLM condensation (production) | 6 | 2.3 | 100% | 100% (6/6) | 1.000 | 100% | 100% |

**Citation accuracy** (full production answers, all questions)

56 of 57 citations verified (98%) across 30 answers. Wrong timestamp: 1. Lesson not among the excerpts: 0. Answers with no parseable citation: 0. Timestamps outside a parseable citation: 4 (compound citations naming two ranges at once; the parser reads the first).

**Per-question changes in hit@k**

| Comparison | Newly hit | Newly missed |
|---|---|---|
| + HyDE vs Vector search only | +2 | -1 |
| + Rerank (no HyDE) vs Vector search only | +0 | -0 |
| + HyDE + Rerank (production) vs + HyDE | +2 | -1 |
| + HyDE + Rerank (production) vs + Rerank (no HyDE) | +3 | -1 |
| Previous turn + follow-up, concatenated vs Follow-up alone (no condensation) | +2 | -1 |
| LLM condensation (production) vs Previous turn + follow-up, concatenated | +2 | -0 |
| LLM condensation (production) vs Follow-up alone (no condensation) | +3 | -0 |
