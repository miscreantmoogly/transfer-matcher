// Split transfers: one withdrawal that lands as several deposits (or several
// withdrawals that land as one deposit), e.g. $50K out of Cedar's checking
// arriving as $30K in Hollis checking + $20K in Hollis savings.
//
// This is a bounded subset-sum search, run only on what's LEFT after one-to-one
// matching. Subset-sum is exponential in general; we keep it cheap with hard
// bounds: at most `maxSplitParts` pieces, only pieces inside the date window,
// only pieces smaller than the total, and at most MAX_CANDIDATES pieces to
// choose from. With 3 parts out of 20 candidates that's < 1,400 combinations.

import { addDays, businessDaysBetween } from "../dates";
import { scoreGroup, tierFor, type GroupScore, type Lookup } from "./score";
import { legsKeyOf, type MatchTxn, type MatcherConfig } from "./types";

const MAX_CANDIDATES = 20;

export type SplitCandidate = { outs: MatchTxn[]; ins: MatchTxn[]; score: GroupScore; legsKey: string };

export function findSplits(
  leftoverOuts: MatchTxn[],
  leftoverIns: MatchTxn[],
  lookup: Lookup,
  config: MatcherConfig,
  rejected: Set<string>,
): SplitCandidate[] {
  const found: SplitCandidate[] = [];

  // Pools sorted by date, so each search only scans the few days around the
  // whole transaction instead of every leftover (which made this quadratic).
  const byDate = (xs: MatchTxn[]) => [...xs].sort((a, b) => a.postedDate.localeCompare(b.postedDate));
  const outsByDate = byDate(leftoverOuts);
  const insByDate = byDate(leftoverIns);
  const lowerBound = (xs: MatchTxn[], date: string) => {
    let lo = 0, hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid].postedDate < date) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** Calendar-day bounds wide enough to contain the business-day window; the exact check follows. */
  const nearby = (xs: MatchTxn[], date: string) => {
    // N business days never spans more than N * 7/5 + 3 calendar days.
    const span = Math.ceil((Math.max(config.windowBusinessDays, config.maxEarlyBusinessDays) * 7) / 5) + 3;
    const from = addDays(date, -span);
    const to = addDays(date, span);
    const out: MatchTxn[] = [];
    for (let k = lowerBound(xs, from); k < xs.length && xs[k].postedDate <= to; k++) out.push(xs[k]);
    return out;
  };

  // `whole` is the single transaction; `parts` are the pieces that sum to it.
  const search = (whole: MatchTxn, sortedPool: MatchTxn[], wholeIsOut: boolean) => {
    const pool = nearby(sortedPool, whole.postedDate);
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

    // Find 2- and 3-piece combinations that sum exactly to the target with a
    // hash lookup on the last piece instead of enumerating every combination:
    // O(k) for pairs and O(k^2) for triples, with k <= MAX_CANDIDATES.
    const amounts = parts.map((p) => Math.abs(p.amountCents));
    const byAmount = new Map<number, number[]>();
    amounts.forEach((a, i) => byAmount.set(a, [...(byAmount.get(a) ?? []), i]));
    const combos: MatchTxn[][] = [];
    for (let i = 0; i < parts.length; i++) {
      for (const j of byAmount.get(target - amounts[i]) ?? []) if (j > i) combos.push([parts[i], parts[j]]);
      if (config.maxSplitParts < 3) continue;
      for (let j = i + 1; j < parts.length; j++) {
        for (const k of byAmount.get(target - amounts[i] - amounts[j]) ?? []) if (k > j) combos.push([parts[i], parts[j], parts[k]]);
      }
    }
    for (const combo of combos) {
      const outs = wholeIsOut ? [whole] : combo;
      const ins = wholeIsOut ? combo : [whole];
      const legsKey = legsKeyOf([...outs, ...ins].map((t) => t.id));
      if (rejected.has(legsKey)) continue;
      const score = scoreGroup(outs, ins, lookup);
      if (tierFor(score, config) !== null) found.push({ outs, ins, score, legsKey });
    }
  };

  for (const out of leftoverOuts) search(out, insByDate, true);
  for (const inTxn of leftoverIns) search(inTxn, outsByDate, false);

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
