# Held-out evaluation

25 synthetic customers per round x ~300 transactions each, from lib/stress.ts: a generator
written after the weights were set, with different memo wording, a realistic lag distribution,
non-round transfers, and round-number commerce that collides with transfer amounts.

Numbers below are for the CURRENT matcher on all three rounds. Rounds 1 and 2 each motivated a
fix, so they're no longer clean; round 3 used seeds nobody had looked at.

| Metric | Round 1 (seeds 10001+) | Round 2 (seeds 20001+) | Round 3, fresh (seeds 30001+) |
|---|---|---|---|
| Real transfers | 1125 | 1125 | 1125 |
| Recall (any tier) | 97.2% | 97.5% | 97.7% |
| Strong-tier precision | 99.7% (679 / 681) | 99.8% (661 / 662) | 100.0% (663 / 663) |
| Check-tier precision | 91.0% (415 / 456) | 93.4% (436 / 467) | 92.0% (436 / 474) |
| Worst single customer, strong precision | 96.2% | 95.7% | 100.0% |

## What round 1 taught, and what changed

Before any fix, round 1 measured: recall 97.2%, strong precision 99.6% (678 / 681), check precision 91.0%.

1. **Fixed:** the "memo names a different account" check only understood the `...4821` style.
   Real memos also say `FROM 4821` or `XXXXXX4821`. It now recognizes any of the customer's own
   account numbers as a standalone token. This caused one of the three strong-tier mistakes.
2. **Not fixed, on purpose:** most check-tier false positives pair a bland `DEPOSIT` with commerce
   the hard-coded categorizer doesn't know ("LAND RENT", "LOAN PMT", "ZELLE"). The production fix is
   the customer's own vendor list and tagging history, not a longer word list.
3. **Fixed after round 2** (which measured strong precision 99.5%, 658 / 661): two $8,500 withdrawals
   from one account on the same day were cross-paired, although one memo said "ACH HOLLIS RANCH".
   The matcher penalized a memo naming a different *account* but not a different *business*. It now
   penalizes both. Round 3 then ran on fresh seeds.
4. **Misses** are mostly bland memos ("ACH DEBIT" / "DEPOSIT") combined with slow posting, which
   score below the proposal threshold, plus lags past the 5-day window.

## Recall by kind (round 3)

| Kind | Found / total |
|---|---|
| intercompany | 603 / 620 (97.3%) |
| same_entity | 142 / 145 (97.9%) |
| owner | 319 / 325 (98.2%) |
| split | 35 / 35 (100.0%) |

## Sample false positives (round 3)

- [review, 0.448] 2026-04-27 hollis-chk -18000.00 "ZELLE TO J MARTINEZ"  <->  2026-04-30 land-chk 18000.00 "ZELLE FROM K NGUYEN"
- [review, 0.415] 2026-06-08 hollis-chk -3500.00 "LAND RENT - JOHNSON FAMILY"  <->  2026-06-11 hollis-chk -3500.00 "LAND RENT - JOHNSON FAMILY"  <->  2026-06-08 hollis-sav -5500.00 "ZELLE TO J MARTINEZ"  <->  2026-06-10 land-chk 12500.00 "ZELLE FROM K NGUYEN"
- [review, 0.415] 2026-05-27 cedar-sav -19000.00 "CUSTOM HARVEST - SMITH"  <->  2026-05-29 cedar-chk 7500.00 "ZELLE FROM K NGUYEN"  <->  2026-05-27 hollis-chk 11500.00 "CROP INSURANCE INDEMNITY"
- [review, 0.515] 2026-07-02 hollis-chk -21000.00 "LAND RENT - JOHNSON FAMILY"  <->  2026-07-01 hollis-sav 21000.00 "CROP INSURANCE INDEMNITY"
- [review, 0.583] 2026-07-14 hollis-sav -2500.00 "CUSTOM HARVEST - SMITH"  <->  2026-07-15 cedar-sav 2500.00 "DEPOSIT"
- [review, 0.415] 2026-04-09 wes-chk -10000.00 "JOHN DEERE FINANCIAL LOAN PMT"  <->  2026-04-07 land-chk -2500.00 "ZELLE TO J MARTINEZ"  <->  2026-04-09 hollis-chk 12500.00 "ZELLE FROM K NGUYEN"
- [review, 0.583] 2026-04-14 land-chk -19500.00 "CUSTOM HARVEST - SMITH"  <->  2026-04-15 cedar-sav 19500.00 "ZELLE FROM K NGUYEN"
- [review, 0.515] 2026-07-08 hollis-sav -4500.00 "LAND RENT - JOHNSON FAMILY"  <->  2026-07-10 cedar-chk 4500.00 "CROP INSURANCE INDEMNITY"
- [review, 0.448] 2026-07-21 land-chk -19000.00 "LAND RENT - JOHNSON FAMILY"  <->  2026-07-24 cedar-sav 19000.00 "ZELLE FROM K NGUYEN"
- [review, 0.583] 2026-07-17 hollis-sav -3000.00 "LAND RENT - JOHNSON FAMILY"  <->  2026-07-20 hollis-chk 3000.00 "ZELLE FROM K NGUYEN"

## Sample misses (round 3)

- (intercompany) 2026-07-02 cedar-chk -15722.97 "WITHDRAWAL"  <->  2026-07-07 hollis-sav 15722.97 "DEPOSIT"
- (intercompany) 2026-07-14 hollis-chk -21500.00 "ACH DEBIT"  <->  2026-07-23 cedar-sav 21500.00 "PAYMENT FROM HOLLIS RANCH"
- (intercompany) 2026-06-30 cedar-chk -8000.00 "WITHDRAWAL"  <->  2026-07-06 hollis-sav 8000.00 "ACH CREDIT"
- (owner) 2026-05-27 cedar-chk -10174.27 "ACH DEBIT"  <->  2026-06-01 wes-chk 10174.27 "ACH CREDIT"
- (owner) 2026-05-22 cedar-sav -12000.00 "WES HOLLIS TRANSFER"  <->  2026-06-02 wes-chk 12000.00 "DEPOSIT"
- (intercompany) 2026-06-09 cedar-sav -24500.00 "ACH DEBIT"  <->  2026-06-15 land-chk 24500.00 "ACH CREDIT"
- (intercompany) 2026-07-07 land-chk -28000.00 "WITHDRAWAL"  <->  2026-07-14 hollis-sav 28000.00 "DEPOSIT"
- (owner) 2026-07-22 wes-chk -17000.00 "ACH DEBIT"  <->  2026-07-29 cedar-sav 17000.00 "DEPOSIT"
- (intercompany) 2026-07-13 cedar-chk -2000.00 "ACH DEBIT"  <->  2026-07-22 hollis-sav 2000.00 "ACH CREDIT"
- (same_entity) 2026-04-13 hollis-chk -500.00 "INTERNAL TRANSFER TO ...3307"  <->  2026-04-22 hollis-sav 500.00 "TRANSFER"
