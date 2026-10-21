// findTransfers: the whole matcher, start to finish.
//
//   1. Candidates  - pair every withdrawal with deposits of the same amount
//                    (or a few dollars less: fees) on a DIFFERENT account,
//                    posted within the date window.
//   2. Score       - additive, explainable score per candidate pair.
//   3. Assign      - choose non-overlapping pairs: exact optimum per block.
//   4. Splits      - bounded subset-sum on whatever is left over.
//   5. Tier        - "high" (bulk-acceptable) / "review" / not proposed.
//
// Output is a PLAN, not a change: nothing here writes to the books. A human
// reviews the plan; deterministic code applies what they accept. (Same split
// of responsibilities as Ambrook's PlanBrook / AmDo.)

import { businessDaysBetween } from "../dates";
import { assignPairs, type Edge } from "./assign";
import { scoreGroup, tierFor, type GroupScore, type Lookup } from "./score";
import { findSplits } from "./splits";
import {
  DEFAULT_CONFIG,
  legsKeyOf,
  type MatchInput,
  type MatchResult,
  type MatchStats,
  type MatchTxn,
  type ProposedMatch,
} from "./types";

export * from "./types";

/** Index of `sorted` (ascending) where values >= target begin. */
function lowerBound(sorted: MatchTxn[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].amountCents < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function findTransfers(input: MatchInput): MatchResult {
  const config = { ...DEFAULT_CONFIG, ...input.config };
  const rejected = input.rejectedLegsKeys ?? new Set<string>();
  const stats: MatchStats = { candidatePairs: 0, blocks: 0, exactBlocks: 0, greedyBlocks: 0, splitsFound: 0 };

  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const entities = new Map(input.entities.map((e) => [e.id, e]));
  const lookup: Lookup = {
    account: (id) => accounts.get(id) ?? fail(`unknown account ${id}`),
    entity: (id) => entities.get(id) ?? fail(`unknown entity ${id}`),
  };
  const byId = new Map(input.transactions.map((t) => [t.id, t]));

  const outs = input.transactions.filter((t) => t.amountCents < 0);
  // Deposits sorted by amount so each withdrawal can binary-search its range.
  const ins = input.transactions.filter((t) => t.amountCents > 0).sort((a, b) => a.amountCents - b.amountCents);

  // ---- 1 + 2: candidate pairs, scored -------------------------------------
  const edges: Edge[] = [];
  const scores = new Map<string, GroupScore>();
  for (const out of outs) {
    const amount = -out.amountCents;
    // Deposits in [amount - feeTolerance, amount]: "blocking" by amount means
    // we never compare a $40,000 withdrawal with a $12.17 deposit.
    for (let k = lowerBound(ins, amount - config.feeToleranceCents); k < ins.length && ins[k].amountCents <= amount; k++) {
      const dep = ins[k];
      if (dep.accountId === out.accountId) continue; // money can't transfer to its own account
      const gap = businessDaysBetween(out.postedDate, dep.postedDate);
      if (gap < -config.maxEarlyBusinessDays || gap > config.windowBusinessDays) continue;
      const legsKey = legsKeyOf([out.id, dep.id]);
      if (rejected.has(legsKey)) continue;

      stats.candidatePairs++;
      const s = scoreGroup([out], [dep], lookup);
      if (tierFor(s, config) === null) continue; // too weak to even propose
      scores.set(legsKey, s);
      edges.push({ outId: out.id, inId: dep.id, score: s.score });
    }
  }

  // ---- 3: choose non-overlapping pairs -----------------------------------
  const proposals: ProposedMatch[] = [];
  const used = new Set<string>();
  for (const e of assignPairs(edges, config, stats)) {
    const legsKey = legsKeyOf([e.outId, e.inId]);
    proposals.push(toProposal([e.outId], [e.inId], scores.get(legsKey)!, legsKey, config));
    used.add(e.outId);
    used.add(e.inId);
  }

  // ---- 4: splits among the leftovers --------------------------------------
  const leftoverOuts = outs.filter((t) => !used.has(t.id));
  const leftoverIns = ins.filter((t) => !used.has(t.id));
  for (const split of findSplits(leftoverOuts, leftoverIns, lookup, config, rejected)) {
    stats.splitsFound++;
    proposals.push(toProposal(split.outs.map((t) => t.id), split.ins.map((t) => t.id), split.score, split.legsKey, config));
    [...split.outs, ...split.ins].forEach((t) => used.add(t.id));
  }

  // ---- 5: order by date for a stable, readable plan -----------------------
  const firstDate = (p: ProposedMatch) => [...p.outIds, ...p.inIds].map((id) => byId.get(id)!.postedDate).sort()[0];
  proposals.sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || a.legsKey.localeCompare(b.legsKey));

  return {
    proposals,
    unmatchedIds: input.transactions.filter((t) => !used.has(t.id)).map((t) => t.id),
    stats,
  };
}

function toProposal(
  outIds: string[],
  inIds: string[],
  s: GroupScore,
  legsKey: string,
  config: typeof DEFAULT_CONFIG,
): ProposedMatch {
  return {
    // Sorted so the plan is identical no matter what order the bank sent rows in.
    outIds: [...outIds].sort(),
    inIds: [...inIds].sort(),
    kind: s.kind,
    score: s.score,
    tier: tierFor(s, config)!,
    reasons: s.reasons,
    feeCents: s.feeCents,
    legsKey,
  };
}

function fail(message: string): never {
  throw new Error(message);
}
