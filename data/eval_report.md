# Transfer matcher evaluation

231 bank transactions, 38 true transfers, 9 traps.

## Default config

| Tier | Proposed | Correct | Precision |
|---|---|---|---|
| high (bulk-accept) | 28 | 28 | 100% |
| review | 10 | 9 | 90% |

- **Recall (any tier):** 97% of true transfers proposed
- **Auto recall (high tier only):** 74% handled with one click
- **Overall precision:** 97%
- Candidate pairs scored: 50; blocks: 34 (34 exact, 0 greedy); splits: 2

### Missed transfers

- T26 (hard): Paper check between entities: no transfer wording at all

### False positives

- [review, 0.683] 2026-09-10 hollis-chk -4500.00 "ONLINE TRANSFER TO R MILLER"  <->  2026-09-11 cedar-chk 4500.00 "DEPOSIT"

### Recall by difficulty

| Difficulty | Found / total |
|---|---|
| easy | 22 / 22 |
| medium | 6 / 6 |
| hard | 9 / 10 |

## Sweep: date window (business days)

| Window | Recall | Auto recall | Precision | High-tier precision | Candidate pairs |
|---|---|---|---|---|---|
| 1 | 74% | 63% | 93% | 100% | 39 |
| 2 | 89% | 71% | 97% | 100% | 45 |
| 3 | 92% | 71% | 97% | 100% | 47 |
| 4 | 95% | 74% | 97% | 100% | 49 |
| 5 | 97% | 74% | 97% | 100% | 50 |
| 6 | 97% | 74% | 97% | 100% | 50 |
| 7 | 97% | 74% | 97% | 100% | 51 |

## Sweep: "high" threshold

| High threshold | Auto recall | High-tier precision |
|---|---|---|
| 0.55 | 79% | 97% |
| 0.65 | 74% | 97% |
| 0.75 | 74% | 100% |
| 0.85 | 71% | 100% |
| 0.95 | 71% | 100% |

## Exact vs greedy assignment

| Assignment | Recall | Precision | Missed |
|---|---|---|---|
| exact | 97% | 97% | T26 |
| greedy | 92% | 95% | T26, T27, T28 |
