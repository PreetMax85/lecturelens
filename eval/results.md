Model: `gemini-3.1-flash-lite`. Index: 1955 chunks. Rerank responses that failed to parse (fell back to vector order): 0.

`k` is the number of results the configuration actually returned, shown in the Avg results column. It is 5 on the rows without rerank. The reranker drops excerpts it judges irrelevant instead of padding the list, so on the reranked rows it is at most 5 and usually fewer. A shorter list can only lose hits, never gain them.

**Single-turn questions**

| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |
|---|---|---|---|---|---|---|---|
| Vector search only | 38 | 5.0 | 39% | 61% (23/38) | 0.482 | 87% | 68% |
| + HyDE | 38 | 5.0 | 45% | 63% (24/38) | 0.526 | 87% | 74% |
| + Rerank (no HyDE) | 38 | 3.2 | 63% | 68% (26/38) | 0.658 | 87% | 68% |
| + HyDE + Rerank (production) | 38 | 3.1 | 66% | 71% (27/38) | 0.684 | 87% | 74% |

**HyDE variance** (single-turn, 4 independent HyDE draws at temperature 0.4, min / mean / max; the table above is draw 1)

| Configuration | Hit@1 | Hit@k | MRR@k | Pool recall@10 | Questions whose hit@k flips |
|---|---|---|---|---|---|
| + HyDE | 32% / 39% / 45% | 63% / 66% / 68% | 0.455 / 0.501 / 0.536 | 74% / 76% / 79% | 4 of 38 (c04, c10, p01, p18) |
| + HyDE + Rerank (production) | 61% / 65% / 71% | 71% / 73% / 76% | 0.658 / 0.685 / 0.728 | 74% / 76% / 79% | 6 of 38 (c04, c07, c13, c14, p01, p13) |

Rerank responses that failed to parse in the extra draws: 0.

**Multi-turn follow-ups** (all rows use HyDE + rerank)

| Configuration | n | Avg results | Hit@1 | Hit@k | MRR@k | Lesson hit@k | Pool recall@10 |
|---|---|---|---|---|---|---|---|
| Follow-up alone (no condensation) | 12 | 2.6 | 50% | 67% (8/12) | 0.563 | 83% | 67% |
| Previous turn + follow-up, concatenated | 12 | 3.8 | 8% | 67% (8/12) | 0.354 | 83% | 67% |
| LLM condensation (production) | 12 | 2.5 | 75% | 83% (10/12) | 0.792 | 92% | 92% |

**Citation accuracy** (full production answers, all questions)

104 of 105 citations verified (99%) across 55 answers. Wrong timestamp: 1. Lesson not among the excerpts: 0. Answers with no parseable citation: 4. Timestamps outside a parseable citation: 0 (nonzero means some citation was written in a shape the parser does not recognise).

**Questions the course does not cover** (full production answers)

4 of 5 answers said the course does not cover it (keyword check; the full answers are in results.json and are read by hand).

| Question | Said not covered | Citations |
|---|---|---|
| n01: How do I configure background audio playback so audio keeps playing when the app is minimized or the phone screen is locked? | yes | 3 |
| n02: What library or native API do we use to scan for and pair with nearby Bluetooth Low Energy (BLE) peripheral devices? | yes | 0 |
| n03: How do we integrate RevenueCat into Expo to handle monthly recurring in-app subscriptions for iOS and Android? | yes | 0 |
| n04: How do I add native Apple Pay and Google Pay payment buttons to my app's checkout screen? | yes | 0 |
| n05: I recorded a voice clip using the audio API, but how do I get the local file path so I can play it back in an audio player? | no | 3 |

**Per-question changes in hit@k**

| Comparison | Newly hit | Newly missed |
|---|---|---|
| + HyDE vs Vector search only | +3 | -2 |
| + Rerank (no HyDE) vs Vector search only | +3 | -0 |
| + HyDE + Rerank (production) vs + HyDE | +4 | -1 |
| + HyDE + Rerank (production) vs + Rerank (no HyDE) | +3 | -2 |
| Previous turn + follow-up, concatenated vs Follow-up alone (no condensation) | +2 | -2 |
| LLM condensation (production) vs Previous turn + follow-up, concatenated | +3 | -1 |
| LLM condensation (production) vs Follow-up alone (no condensation) | +3 | -1 |
