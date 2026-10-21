// Held-out evaluation: run the matcher, unchanged, on data from a generator it
// was never tuned on (lib/stress.ts), across many seeds.
//
//   npm run heldout   ->  prints a report and writes data/heldout_report.md

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { findTransfers, legsKeyOf } from "../lib/matcher";
import { generateStressCase } from "../lib/stress";

const SEEDS = 25;
const SIZE = 300; // transactions per customer, roughly one 4-month window

type Tally = { proposedHigh: number; correctHigh: number; proposedReview: number; correctReview: number; truth: number; found: number };

function evaluate(seedBase: number) {
  const total: Tally = { proposedHigh: 0, correctHigh: 0, proposedReview: 0, correctReview: 0, truth: 0, found: 0 };
  const byKind = new Map<string, { truth: number; found: number }>();
  const falsePositives: string[] = [];
  const misses: string[] = [];
  const perSeedHighPrecision: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = generateStressCase({ seed: seedBase + seed, size: SIZE });
    const result = findTransfers({ transactions: c.transactions, accounts: c.accounts, entities: c.entities });
    const byId = new Map(c.transactions.map((t) => [t.id, t]));
    const describe = (ids: string[]) =>
      ids.map((id) => { const t = byId.get(id)!; return `${t.postedDate} ${t.accountId} ${(t.amountCents / 100).toFixed(2)} "${t.memo}"`; }).join("  <->  ");
    const truthKeys = new Map(c.truth.map((g) => [legsKeyOf([...g.outs, ...g.ins]), g]));
    const found = new Set<string>();
    let seedHigh = 0, seedHighOk = 0;
    for (const p of result.proposals) {
      const ok = truthKeys.has(p.legsKey);
      if (p.tier === "high") { total.proposedHigh++; seedHigh++; if (ok) { total.correctHigh++; seedHighOk++; } }
      else { total.proposedReview++; if (ok) total.correctReview++; }
      if (ok) found.add(p.legsKey);
      else if (falsePositives.length < 10) falsePositives.push(`[${p.tier}, ${p.score}] ${describe([...p.outIds, ...p.inIds])}`);
    }
    perSeedHighPrecision.push(seedHigh ? seedHighOk / seedHigh : 1);
    for (const g of c.truth) {
      const k = legsKeyOf([...g.outs, ...g.ins]);
      const entry = byKind.get(g.kind) ?? { truth: 0, found: 0 };
      entry.truth++;
      total.truth++;
      if (found.has(k)) { entry.found++; total.found++; }
      else if (misses.length < 10) misses.push(`(${g.kind}) ${describe([...g.outs, ...g.ins])}`);
      byKind.set(g.kind, entry);
    }
  }
  return { total, byKind, falsePositives, misses, worst: Math.min(...perSeedHighPrecision) };
}

// Round 1 found problems (seeds 10001-10025). After fixing them, round 2 runs on
// FRESH seeds (20001-20025) that were never looked at, so the fix isn't graded
// on the data that motivated it.
const dev = evaluate(10_000);
const dev2 = evaluate(20_000);
const test = evaluate(30_000);

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const row = (name: string, f: (r: ReturnType<typeof evaluate>) => string) => `| ${name} | ${f(dev)} | ${f(dev2)} | ${f(test)} |`;
const lines = [
  `# Held-out evaluation`,
  ``,
  `${SEEDS} synthetic customers per round x ~${SIZE} transactions each, from lib/stress.ts: a generator`,
  `written after the weights were set, with different memo wording, a realistic lag distribution,`,
  `non-round transfers, and round-number commerce that collides with transfer amounts.`,
  ``,
  `Numbers below are for the CURRENT matcher on all three rounds. Rounds 1 and 2 each motivated a`,
  `fix, so they're no longer clean; round 3 used seeds nobody had looked at.`,
  ``,
  `| Metric | Round 1 (seeds 10001+) | Round 2 (seeds 20001+) | Round 3, fresh (seeds 30001+) |`,
  `|---|---|---|---|`,
  row("Real transfers", (r) => String(r.total.truth)),
  row("Recall (any tier)", (r) => pct(r.total.found, r.total.truth)),
  row("Strong-tier precision", (r) => `${pct(r.total.correctHigh, r.total.proposedHigh)} (${r.total.correctHigh} / ${r.total.proposedHigh})`),
  row("Check-tier precision", (r) => `${pct(r.total.correctReview, r.total.proposedReview)} (${r.total.correctReview} / ${r.total.proposedReview})`),
  row("Worst single customer, strong precision", (r) => pct(r.worst, 1)),
  ``,
  `## What round 1 taught, and what changed`,
  ``,
  `Before any fix, round 1 measured: recall 97.2%, strong precision 99.6% (678 / 681), check precision 91.0%.`,
  ``,
  `1. **Fixed:** the "memo names a different account" check only understood the \`...4821\` style.`,
  `   Real memos also say \`FROM 4821\` or \`XXXXXX4821\`. It now recognizes any of the customer's own`,
  `   account numbers as a standalone token. This caused one of the three strong-tier mistakes.`,
  `2. **Not fixed, on purpose:** most check-tier false positives pair a bland \`DEPOSIT\` with commerce`,
  `   the hard-coded categorizer doesn't know ("LAND RENT", "LOAN PMT", "ZELLE"). The production fix is`,
  `   the customer's own vendor list and tagging history, not a longer word list.`,
  `3. **Fixed after round 2** (which measured strong precision 99.5%, 658 / 661): two $8,500 withdrawals`,
  `   from one account on the same day were cross-paired, although one memo said "ACH HOLLIS RANCH".`,
  `   The matcher penalized a memo naming a different *account* but not a different *business*. It now`,
  `   penalizes both. Round 3 then ran on fresh seeds.`,
  `4. **Misses** are mostly bland memos ("ACH DEBIT" / "DEPOSIT") combined with slow posting, which`,
  `   score below the proposal threshold, plus lags past the 5-day window.`,
  ``,
  `## Recall by kind (round 3)`,
  ``,
  `| Kind | Found / total |`,
  `|---|---|`,
  ...[...test.byKind.entries()].map(([k, v]) => `| ${k} | ${v.found} / ${v.truth} (${pct(v.found, v.truth)}) |`),
  ``,
  `## Sample false positives (round 3)`,
  ``,
  ...(test.falsePositives.length ? test.falsePositives.map((f) => `- ${f}`) : ["None."]),
  ``,
  `## Sample misses (round 3)`,
  ``,
  ...(test.misses.length ? test.misses.map((m) => `- ${m}`) : ["None."]),
];
const report = lines.join("\n") + "\n";
writeFileSync(join(__dirname, "..", "data", "heldout_report.md"), report);
console.log(report);
