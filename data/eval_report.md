# Transfer matcher evaluation

181 bank transactions, 32 true transfers, 6 traps.

## Default config

| Tier | Proposed | Correct | Precision |
|---|---|---|---|
| high (bulk-accept) | 22 | 22 | 100% |
| review | 10 | 9 | 90% |

- **Recall (any tier):** 97% of true transfers proposed
- **Auto recall (high tier only):** 69% handled with one click
- **Overall precision:** 97%
- Candidate pairs scored: 36; blocks: 29 (29 exact, 0 greedy); splits: 2

### Missed transfers

- T26 (hard): Paper check between entities: no transfer wording at all

### False positives

- [review, 0.683] 2026-09-10 hollis-chk -4500.00 "ONLINE TRANSFER TO R MILLER"  <->  2026-09-11 cedar-chk 4500.00 "DEPOSIT"

### Recall by difficulty

| Difficulty | Found / total |
|---|---|
| easy | 19 / 19 |
| medium | 5 / 5 |
| hard | 7 / 8 |

## Sweep: date window (business days)

| Window | Recall | Auto recall | Precision | High-tier precision | Candidate pairs |
|---|---|---|---|---|---|
| 1 | 69% | 56% | 92% | 100% | 25 |
| 2 | 88% | 66% | 97% | 100% | 31 |
| 3 | 91% | 66% | 97% | 100% | 33 |
| 4 | 94% | 69% | 97% | 100% | 35 |
| 5 | 97% | 69% | 97% | 100% | 36 |
| 6 | 97% | 69% | 97% | 100% | 36 |
| 7 | 97% | 69% | 97% | 100% | 36 |

## Sweep: "high" threshold

| High threshold | Auto recall | High-tier precision |
|---|---|---|
| 0.55 | 75% | 96% |
| 0.65 | 69% | 96% |
| 0.75 | 69% | 100% |
| 0.85 | 66% | 100% |
| 0.95 | 66% | 100% |

## Exact vs greedy assignment

| Assignment | Recall | Precision | Missed |
|---|---|---|---|
| exact | 97% | 97% | T26 |
| greedy | 91% | 94% | T26, T27, T28 |
