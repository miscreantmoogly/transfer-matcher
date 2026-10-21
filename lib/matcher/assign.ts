// Assignment: given scored candidate pairs, choose which pairs to propose so
// that no transaction is used twice.
//
// Why not just take the highest-scoring pair first (greedy)? Because of cases
// like two identical $2,500 transfers two days apart:
//
//     out#1 Mon ----- in#1 Wed          greedy grabs (out#2, in#1): same day,
//     out#2 Wed ----- in#2 Fri          highest score. Now out#1 and in#2 are
//                                       orphaned (or mis-paired).
//
// The globally best answer pairs each withdrawal with its own deposit. Finding
// it is a maximum-weight bipartite matching problem. That's expensive in
// general, but we only need to solve it inside small connected "blocks":
// candidates only exist between transactions with the same amount and close
// dates, so the graph falls apart into tiny components (usually 1x1, rarely
// more than 3x3). Inside each block we can afford an exact search.

import type { MatcherConfig, MatchStats } from "./types";

export type Edge = { outId: string; inId: string; score: number };

/** Split the candidate graph into connected components (union-find). */
export function connectedBlocks(edges: Edge[]): Edge[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // path compression
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    for (const n of [a, b]) if (!parent.has(n)) parent.set(n, n);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const e of edges) union(`o:${e.outId}`, `i:${e.inId}`);

  const blocks = new Map<string, Edge[]>();
  for (const e of edges) {
    const root = find(`o:${e.outId}`);
    if (!blocks.has(root)) blocks.set(root, []);
    blocks.get(root)!.push(e);
  }
  return [...blocks.values()];
}

/** Highest score first; ties broken by ids so the output is deterministic. */
export function greedyAssign(edges: Edge[]): Edge[] {
  const sorted = [...edges].sort(
    (a, b) => b.score - a.score || a.outId.localeCompare(b.outId) || a.inId.localeCompare(b.inId),
  );
  const usedOut = new Set<string>();
  const usedIn = new Set<string>();
  const chosen: Edge[] = [];
  for (const e of sorted) {
    if (usedOut.has(e.outId) || usedIn.has(e.inId)) continue;
    usedOut.add(e.outId);
    usedIn.add(e.inId);
    chosen.push(e);
  }
  return chosen;
}

/**
 * Exact maximum-total-score matching for one small block.
 * Dynamic programming over (index on the bigger side, bitmask of used nodes on
 * the smaller side): O(L * 2^S * S). With S <= 12 that's at most a few
 * hundred thousand steps, which is instant.
 */
export function exactAssign(edges: Edge[]): Edge[] {
  const outIds = [...new Set(edges.map((e) => e.outId))].sort();
  const inIds = [...new Set(edges.map((e) => e.inId))].sort();

  // Put the bitmask on the smaller side.
  const outsAreLeft = outIds.length >= inIds.length;
  const left = outsAreLeft ? outIds : inIds;
  const right = outsAreLeft ? inIds : outIds;
  const rightIndex = new Map(right.map((id, i) => [id, i]));

  // Work in integer milli-points so float rounding can never flip a comparison.
  const adj: Array<Array<{ r: number; pts: number; edge: Edge }>> = left.map(() => []);
  const leftIndex = new Map(left.map((id, i) => [id, i]));
  for (const e of edges) {
    const l = leftIndex.get(outsAreLeft ? e.outId : e.inId)!;
    const r = rightIndex.get(outsAreLeft ? e.inId : e.outId)!;
    adj[l].push({ r, pts: Math.round(e.score * 1000), edge: e });
  }

  const memo = new Map<number, number>();
  const width = 1 << right.length;
  const best = (l: number, mask: number): number => {
    if (l === left.length) return 0;
    const key = l * width + mask;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let value = best(l + 1, mask); // option: leave this one unmatched
    for (const { r, pts } of adj[l]) {
      if (mask & (1 << r)) continue;
      value = Math.max(value, pts + best(l + 1, mask | (1 << r)));
    }
    memo.set(key, value);
    return value;
  };

  // Walk the memo table forwards to recover which edges achieved the optimum.
  const chosen: Edge[] = [];
  let mask = 0;
  for (let l = 0; l < left.length; l++) {
    const target = best(l, mask);
    if (best(l + 1, mask) === target) continue; // optimum leaves l unmatched
    for (const { r, pts, edge } of adj[l]) {
      if (mask & (1 << r)) continue;
      if (pts + best(l + 1, mask | (1 << r)) === target) {
        chosen.push(edge);
        mask |= 1 << r;
        break;
      }
    }
  }
  return chosen;
}

export function assignPairs(edges: Edge[], config: MatcherConfig, stats: MatchStats): Edge[] {
  const chosen: Edge[] = [];
  for (const block of connectedBlocks(edges)) {
    stats.blocks++;
    const smallerSide = Math.min(new Set(block.map((e) => e.outId)).size, new Set(block.map((e) => e.inId)).size);
    if (config.assignment === "exact" && smallerSide <= config.exactAssignmentMaxSize) {
      stats.exactBlocks++;
      chosen.push(...exactAssign(block));
    } else {
      // Pathological block (e.g. hundreds of identical $1,000 transfers):
      // fall back to greedy rather than blow up. Logged via stats.
      stats.greedyBlocks++;
      chosen.push(...greedyAssign(block));
    }
  }
  return chosen;
}
