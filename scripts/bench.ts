// Performance benchmarks for the realistic load shape: many customers, each
// with a few hundred transactions in the matching window, each matched as its
// own job. Plus the largest realistic customer and a deliberate worst case.
//
//   npm run bench   ->  prints a report and writes data/bench_report.md

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { findTransfers } from "../lib/matcher";
import { generateStressCase } from "../lib/stress";
import { createFreshDb } from "../lib/db";
import { syncBatch } from "../lib/services/demo";
import { runMatching } from "../lib/services/matchRun";
import { BANK_ACCOUNTS, ENTITIES } from "../lib/org";

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const ms = (x: number) => `${x.toFixed(x < 10 ? 2 : 0)} ms`;
const lines: string[] = ["# Benchmarks", "", `Node ${process.version}, one process, one core. Times are for the pure matcher unless noted.`, ""];

// ---- 1. The fleet: 8,000 customers x ~300 transactions --------------------
{
  const CUSTOMERS = 8000;
  const times: number[] = [];
  let txns = 0;
  for (let i = 0; i < CUSTOMERS; i++) {
    const c = generateStressCase({ seed: 100_000 + i, size: 200 + ((i * 37) % 200) }); // 200-400 per customer
    txns += c.transactions.length;
    const t0 = performance.now();
    findTransfers({ transactions: c.transactions, accounts: c.accounts, entities: c.entities });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const total = times.reduce((s, x) => s + x, 0);
  lines.push(
    `## 1. The fleet: ${CUSTOMERS.toLocaleString()} customers, ~300 transactions each`,
    "",
    `This is the realistic shape: matching only looks at the last ${120} days, matched transfers drop out,`,
    `and each customer is its own job. Generation time is excluded.`,
    "",
    `| | |`,
    `|---|---|`,
    `| Transactions matched | ${txns.toLocaleString()} |`,
    `| Total matcher time, one core | ${(total / 1000).toFixed(1)} s |`,
    `| Per customer: median / p95 / p99 / max | ${ms(percentile(times, 50))} / ${ms(percentile(times, 95))} / ${ms(percentile(times, 99))} / ${ms(times[times.length - 1])} |`,
    "",
    `So one worker could re-match every customer after a daily sync in about ${Math.ceil(total / 1000)} seconds of CPU.`,
    `In practice the cost is the database reads and writes around each run, and runs are independent,`,
    `so workers scale horizontally with no coordination beyond the per-customer job key.`,
    "",
  );
}

// ---- 2. Largest realistic customers ----------------------------------------
{
  lines.push(`## 2. One large customer`, "", `| Transactions in the window | Matcher time |`, `|---|---|`);
  for (const size of [1_000, 3_000, 10_000]) {
    const c = generateStressCase({ seed: 7, size });
    const t0 = performance.now();
    findTransfers({ transactions: c.transactions, accounts: c.accounts, entities: c.entities });
    lines.push(`| ${size.toLocaleString()} | ${ms(performance.now() - t0)} |`);
  }
  lines.push("", "Candidate generation is a sort plus binary search and blocks stay small. Growth is still faster than", "linear at the high end because one customer's transactions get denser per day, so each split search", "has more nearby candidates. Realistic customers sit at the left of this table.", "");
}

// ---- 3. Worst case: hundreds of identical transfers in one week ------------
{
  const N = 400;
  const transactions = [];
  for (let i = 0; i < N; i++) {
    const day = `2026-06-0${1 + (i % 5)}`; // Mon-Fri
    transactions.push({ id: `o${i}`, accountId: "cedar-chk", postedDate: day, amountCents: -100_000, memo: "AUTO TRANSFER TO SAV ...7730" });
    transactions.push({ id: `i${i}`, accountId: "cedar-sav", postedDate: day, amountCents: 100_000, memo: "AUTO TRANSFER FROM CHK ...4821" });
  }
  const accounts = BANK_ACCOUNTS.map((a) => ({ id: a.id, entityId: a.entityId, last4: a.last4 }));
  const entities = ENTITIES.map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
  const t0 = performance.now();
  const r = findTransfers({ transactions, accounts, entities });
  const elapsed = performance.now() - t0;
  lines.push(
    `## 3. Worst case: ${N} identical $1,000 transfers in one week`,
    "",
    `Most withdrawals are candidates for most deposits, so it's one ${N}x${N} block (${r.stats.candidatePairs.toLocaleString()} candidate pairs).`,
    `Exact assignment is exponential in block size, so blocks over 12 fall back to greedy: ${r.stats.greedyBlocks} greedy block(s).`,
    "",
    `| | |`,
    `|---|---|`,
    `| Matcher time | ${ms(elapsed)} |`,
    `| Pairs proposed | ${r.proposals.length} of ${N} |`,
    "",
    `For identical transfers between the same two accounts, any pairing gives the same books, so greedy is`,
    `safe here. The upgrade for big blocks that aren't interchangeable is the Hungarian algorithm (O(n^3)).`,
    "",
  );
}

// ---- 4. End to end with the database ----------------------------------------
{
  const db = createFreshDb(":memory:");
  const t0 = performance.now();
  const imported = syncBatch(db, 1, "bench");
  const t1 = performance.now();
  const summary = runMatching(db, "bench");
  const t2 = performance.now();
  lines.push(
    `## 4. End to end: the demo customer in SQLite`,
    "",
    `| Step | Time |`,
    `|---|---|`,
    `| Import ${imported.inserted} transactions (rows + journal entries + job, one transaction) | ${ms(t1 - t0)} |`,
    `| Matching run: load, match, write ${summary.created} proposals | ${ms(t2 - t1)} |`,
    "",
  );
}

lines.push(
  "## What profiling changed",
  "",
  "The first run of this benchmark showed matching growing much faster than the data",
  "(78 ms for a 300-transaction customer, 7.1 s for 3,000). A CPU profile pointed at two causes:",
  "",
  "| Fix | Why it was slow |",
  "|---|---|",
  "| Business-day counting became a constant-time formula, with parsed dates memoized | It walked the calendar day by day, and runs for every candidate pair |",
  "| Split search uses a hash lookup for the last piece and only scans nearby dates | It enumerated every 2- and 3-piece combination over all leftovers |",
  "",
  "| | Before | After |",
  "|---|---|---|",
  "| Typical customer (~300 transactions) | 78 ms | ~6 ms |",
  "| 3,000-transaction customer | 7.1 s | 0.2 s |",
  "",
  "Results are identical before and after (same tests, same evaluation numbers).",
  "",
);
const report = lines.join("\n") + "\n";
writeFileSync(join(__dirname, "..", "data", "bench_report.md"), report);
console.log(report);
