// Scores the matcher against the generator's ground truth.
//
//   npm run eval   ->  prints a report and writes data/eval_report.md
//
// A proposal counts as correct only if it groups EXACTLY the right
// transactions (all legs of a split, nothing extra).
//
// Precision matters more than recall here. A false positive hides real money:
// calling a $5,000 feed bill a "transfer" deletes a real expense from the P&L.
// A false negative just leaves a transfer for a human to match by hand, which
// is today's status quo. So "high" must be near-perfect; "review" can be looser.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findTransfers, legsKeyOf, type MatcherConfig, type MatchResult } from "../lib/matcher";
import { BANK_ACCOUNTS, ENTITIES } from "../lib/org";
import type { FeedTransaction, Trap, TruthGroup } from "./generate";

const dataDir = join(__dirname, "..", "data");
const feed: { transactions: FeedTransaction[] } = JSON.parse(readFileSync(join(dataDir, "bank_feed.json"), "utf8"));
const truth: { groups: TruthGroup[]; traps: Trap[] } = JSON.parse(readFileSync(join(dataDir, "ground_truth.json"), "utf8"));

const transactions = feed.transactions.map((t) => ({
  id: t.providerTxnId,
  accountId: t.accountId,
  postedDate: t.postedDate,
  amountCents: t.amountCents,
  memo: t.memo,
}));
const accounts = BANK_ACCOUNTS.map((a) => ({ id: a.id, entityId: a.entityId, last4: a.last4 }));
const entities = ENTITIES.map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
const truthByKey = new Map(truth.groups.map((g) => [legsKeyOf([...g.outs, ...g.ins]), g]));
const memoOf = new Map(feed.transactions.map((t) => [t.providerTxnId, `${t.postedDate} ${t.accountId} ${(t.amountCents / 100).toFixed(2)} "${t.memo}"`]));

type Metrics = {
  high: { proposed: number; correct: number };
  review: { proposed: number; correct: number };
  recall: number;
  autoRecall: number;
  precision: number;
  highPrecision: number;
  missed: TruthGroup[];
  falsePositives: MatchResult["proposals"];
  result: MatchResult;
};

function evaluate(config: Partial<MatcherConfig> = {}): Metrics {
  const result = findTransfers({ transactions, accounts, entities, config });
  const m: Metrics = {
    high: { proposed: 0, correct: 0 },
    review: { proposed: 0, correct: 0 },
    recall: 0, autoRecall: 0, precision: 0, highPrecision: 0,
    missed: [], falsePositives: [], result,
  };
  const found = new Set<string>();
  for (const p of result.proposals) {
    const ok = truthByKey.has(p.legsKey);
    m[p.tier].proposed++;
    if (ok) {
      m[p.tier].correct++;
      found.add(p.legsKey);
    } else m.falsePositives.push(p);
  }
  m.missed = truth.groups.filter((g) => !found.has(legsKeyOf([...g.outs, ...g.ins])));
  const total = truth.groups.length;
  const proposed = m.high.proposed + m.review.proposed;
  m.recall = found.size / total;
  m.autoRecall = m.high.correct / total;
  m.precision = proposed ? (m.high.correct + m.review.correct) / proposed : 1;
  m.highPrecision = m.high.proposed ? m.high.correct / m.high.proposed : 1;
  return m;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const lines: string[] = [];
const out = (s = "") => lines.push(s);

// ---- Headline: default config ---------------------------------------------
const base = evaluate();
out(`# Transfer matcher evaluation`);
out();
out(`${transactions.length} bank transactions, ${truth.groups.length} true transfers, ${truth.traps.length} traps.`);
out();
out(`## Default config`);
out();
out(`| Tier | Proposed | Correct | Precision |`);
out(`|---|---|---|---|`);
out(`| high (bulk-accept) | ${base.high.proposed} | ${base.high.correct} | ${pct(base.highPrecision)} |`);
out(`| review | ${base.review.proposed} | ${base.review.correct} | ${pct(base.review.proposed ? base.review.correct / base.review.proposed : 1)} |`);
out();
out(`- **Recall (any tier):** ${pct(base.recall)} of true transfers proposed`);
out(`- **Auto recall (high tier only):** ${pct(base.autoRecall)} handled with one click`);
out(`- **Overall precision:** ${pct(base.precision)}`);
out(`- Candidate pairs scored: ${base.result.stats.candidatePairs}; blocks: ${base.result.stats.blocks} (${base.result.stats.exactBlocks} exact, ${base.result.stats.greedyBlocks} greedy); splits: ${base.result.stats.splitsFound}`);
out();
out(`### Missed transfers`);
out();
if (base.missed.length === 0) out(`None.`);
for (const g of base.missed) out(`- ${g.id} (${g.difficulty}): ${g.label}`);
out();
out(`### False positives`);
out();
if (base.falsePositives.length === 0) out(`None.`);
for (const p of base.falsePositives) {
  out(`- [${p.tier}, ${p.score}] ${[...p.outIds, ...p.inIds].map((id) => memoOf.get(id)).join("  <->  ")}`);
}

// ---- By difficulty -----------------------------------------------------------
out();
out(`### Recall by difficulty`);
out();
out(`| Difficulty | Found / total |`);
out(`|---|---|`);
for (const d of ["easy", "medium", "hard"] as const) {
  const all = truth.groups.filter((g) => g.difficulty === d);
  const missed = base.missed.filter((g) => g.difficulty === d).length;
  out(`| ${d} | ${all.length - missed} / ${all.length} |`);
}

// ---- Sweep: date window ------------------------------------------------------
out();
out(`## Sweep: date window (business days)`);
out();
out(`| Window | Recall | Auto recall | Precision | High-tier precision | Candidate pairs |`);
out(`|---|---|---|---|---|---|`);
for (let w = 1; w <= 7; w++) {
  const m = evaluate({ windowBusinessDays: w });
  out(`| ${w} | ${pct(m.recall)} | ${pct(m.autoRecall)} | ${pct(m.precision)} | ${pct(m.highPrecision)} | ${m.result.stats.candidatePairs} |`);
}

// ---- Sweep: high threshold ---------------------------------------------------
out();
out(`## Sweep: "high" threshold`);
out();
out(`| High threshold | Auto recall | High-tier precision |`);
out(`|---|---|---|`);
for (const t of [0.55, 0.65, 0.75, 0.85, 0.95]) {
  const m = evaluate({ highThreshold: t });
  out(`| ${t} | ${pct(m.autoRecall)} | ${pct(m.highPrecision)} |`);
}

// ---- Exact vs greedy assignment --------------------------------------------
out();
out(`## Exact vs greedy assignment`);
out();
out(`| Assignment | Recall | Precision | Missed |`);
out(`|---|---|---|---|`);
for (const assignment of ["exact", "greedy"] as const) {
  const m = evaluate({ assignment });
  out(`| ${assignment} | ${pct(m.recall)} | ${pct(m.precision)} | ${m.missed.map((g) => g.id).join(", ") || "-"} |`);
}

const report = lines.join("\n") + "\n";
writeFileSync(join(dataDir, "eval_report.md"), report);
console.log(report);
