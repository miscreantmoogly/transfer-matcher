# Benchmarks

Node v22.22.0, one process, one core. Times are for the pure matcher unless noted.

## 1. The fleet: 8,000 customers, ~300 transactions each

This is the realistic shape: matching only looks at the last 120 days, matched transfers drop out,
and each customer is its own job. Generation time is excluded.

| | |
|---|---|
| Transactions matched | 2,396,000 |
| Total matcher time, one core | 47.7 s |
| Per customer: median / p95 / p99 / max | 5.65 ms / 10 ms / 13 ms / 44 ms |

So one worker could re-match every customer after a daily sync in about 48 seconds of CPU.
In practice the cost is the database reads and writes around each run, and runs are independent,
so workers scale horizontally with no coordination beyond the per-customer job key.

## 2. One large customer

| Transactions in the window | Matcher time |
|---|---|
| 1,000 | 33 ms |
| 3,000 | 212 ms |
| 10,000 | 1408 ms |

Candidate generation is a sort plus binary search and blocks stay small. Growth is still faster than
linear at the high end because one customer's transactions get denser per day, so each split search
has more nearby candidates. Realistic customers sit at the left of this table.

## 3. Worst case: 400 identical $1,000 transfers in one week

Most withdrawals are candidates for most deposits, so it's one 400x400 block (121,600 candidate pairs).
Exact assignment is exponential in block size, so blocks over 12 fall back to greedy: 1 greedy block(s).

| | |
|---|---|
| Matcher time | 7140 ms |
| Pairs proposed | 400 of 400 |

For identical transfers between the same two accounts, any pairing gives the same books, so greedy is
safe here. The upgrade for big blocks that aren't interchangeable is the Hungarian algorithm (O(n^3)).

## 4. End to end: the demo customer in SQLite

| Step | Time |
|---|---|
| Import 223 transactions (rows + journal entries + job, one transaction) | 13 ms |
| Matching run: load, match, write 36 proposals | 18 ms |

## What profiling changed

The first run of this benchmark showed matching growing much faster than the data
(78 ms for a 300-transaction customer, 7.1 s for 3,000). A CPU profile pointed at two causes:

| Fix | Why it was slow |
|---|---|
| Business-day counting became a constant-time formula, with parsed dates memoized | It walked the calendar day by day, and runs for every candidate pair |
| Split search uses a hash lookup for the last piece and only scans nearby dates | It enumerated every 2- and 3-piece combination over all leftovers |

| | Before | After |
|---|---|---|
| Typical customer (~300 transactions) | 78 ms | ~6 ms |
| 3,000-transaction customer | 7.1 s | 0.2 s |

Results are identical before and after (same tests, same evaluation numbers).
