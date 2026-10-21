// Split transfers: one withdrawal that lands as several deposits (or several
// withdrawals that land as one deposit), e.g. $50K out of Cedar's checking
// arriving as $30K in Hollis checking + $20K in Hollis savings.
//
// This is a bounded subset-sum search, run only on what's LEFT after one-to-one
// matching. Subset-sum is exponential in general; we keep it cheap with hard
// bounds: at most `maxSplitParts` pieces, only pieces inside the date window,
// only pieces smaller than the total, and at most MAX_CANDIDATES pieces to
// choose from. With 3 parts out of 20 candidates that's < 1,400 combinations.

import { businessDaysBetween } from "../dates";
import { scoreGroup, tierFor, type GroupScore, type Lookup } from "./score";
import { legsKeyOf, type MatchTxn, type MatcherConfig } from "./types";

const MAX_CANDIDATES = 20;

export type SplitCandidate = { outs: MatchTxn[]; ins: MatchTxn[]; score: GroupScore; legsKey: string };

function* combinations<T>(items: T[], size: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, size, i + 1, [...prefix, items[i]]);
}

export function findSplits(
  leftoverOuts: MatchTxn[],
  leftoverIns: MatchTxn[],
  lookup: Lookup,
  config: MatcherConfig,
  rejected: Set<string>,
): SplitCandidate[] {
  const found: SplitCandidate[] = [];

  // `whole` is the single transaction; `parts` are the pieces that sum to it.
  const search = (whole: MatchTxn, pool: MatchTxn[], wholeIsOut: boolean) => {
    const target = Math.abs(whole.amountCents);
    const gapOf = (part: MatchTxn) =>
      wholeIsOut
        ? businessDaysBetween(whole.postedDate, part.postedDate)
        : businessDaysBetween(part.postedDate, whole.postedDate);
    const parts = pool
      .filter((p) => p.accountId !== whole.accountId)
      .filter((p) => Math.abs(p.amountCents) < target)
      .filter((p) => {
        const gap = gapOf(p);
        return gap >= -config.maxEarlyBusinessDays && gap <= config.windowBusinessDays;
      })
      .sort((a, b) => Math.abs(gapOf(a)) - Math.abs(gapOf(b)) || a.id.localeCompare(b.id))
      .slice(0, MAX_CANDIDATES);

    for (let size = 2; size <= config.maxSplitParts; size++) {
      for (const combo of combinations(parts, size)) {
        const sum = combo.reduce((s, p) => s + Math.abs(p.amountCents), 0);
        if (sum !== target) continue;
        const outs = wholeIsOut ? [whole] : combo;
        const ins = wholeIsOut ? combo : [whole];
        const legsKey = legsKeyOf([...outs, ...ins].map((t) => t.id));
        if (rejected.has(legsKey)) continue;
        const score = scoreGroup(outs, ins, lookup);
        if (tierFor(score, config) !== null) found.push({ outs, ins, score, legsKey });
      }
    }
  };

  for (const out of leftoverOuts) search(out, leftoverIns, true);
  for (const inTxn of leftoverIns) search(inTxn, leftoverOuts, false);

  // Keep the best non-overlapping set (greedy is fine here: splits are rare).
  found.sort((a, b) => b.score.score - a.score.score || a.legsKey.localeCompare(b.legsKey));
  const used = new Set<string>();
  const chosen: SplitCandidate[] = [];
  for (const c of found) {
    const ids = [...c.outs, ...c.ins].map((t) => t.id);
    if (ids.some((id) => used.has(id))) continue;
    ids.forEach((id) => used.add(id));
    chosen.push(c);
  }
  return chosen;
}
