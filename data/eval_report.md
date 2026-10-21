# Transfer matcher evaluation

179 bank transactions, 32 true transfers, 5 traps.

## Default config

| Tier | Proposed | Correct | Precision |
|---|---|---|---|
| high (bulk-accept) | 22 | 22 | 100% |
| review | 9 | 9 | 100% |

- **Recall (any tier):** 97% of true transfers proposed
- **Auto recall (high tier only):** 69% handled with one click
- **Overall precision:** 100%
- Candidate pairs scored: 35; blocks: 28 (28 exact, 0 greedy); splits: 2

### Missed transfers

- T26 (hard): Paper check between entities: no transfer wording at all

### False positives

None.

### Recall by difficulty

| Difficulty | Found / total |
|---|---|
| easy | 19 / 19 |
| medium | 5 / 5 |
| hard | 7 / 8 |

## Sweep: date window (business days)

| Window | Recall | Auto recall | Precision | High-tier precision | Candidate pairs |
|---|---|---|---|---|---|
| 1 | 69% | 56% | 96% | 100% | 24 |
| 2 | 88% | 66% | 100% | 100% | 30 |
| 3 | 91% | 66% | 100% | 100% | 32 |
| 4 | 94% | 69% | 100% | 100% | 34 |
| 5 | 97% | 69% | 100% | 100% | 35 |
| 6 | 97% | 69% | 100% | 100% | 35 |
| 7 | 97% | 69% | 100% | 100% | 35 |

## Sweep: "high" threshold

| High threshold | Auto recall | High-tier precision |
|---|---|---|
| 0.55 | 75% | 100% |
| 0.65 | 69% | 100% |
| 0.75 | 69% | 100% |
| 0.85 | 66% | 100% |
| 0.95 | 66% | 100% |

## Exact vs greedy assignment

| Assignment | Recall | Precision | Missed |
|---|---|---|---|
| exact | 97% | 100% | T26 |
| greedy | 91% | 97% | T26, T27, T28 |
