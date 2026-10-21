// Types for the matcher. The matcher is a PURE function: plain data in, a plan
// out. It never touches the database, the clock, or the network, which makes
// it deterministic, trivially unit-testable, and safe to re-run any time.

import type { MatchKind, MatchTier } from "../domain";

export type MatchTxn = {
  id: string;
  accountId: string;
  postedDate: string; // YYYY-MM-DD
  amountCents: number; // negative = money out
  memo: string;
};

export type AccountInfo = { id: string; entityId: string; last4: string };
export type EntityInfo = { id: string; name: string; kind?: "business" | "personal" };

export type MatcherConfig = {
  /** Max business days a deposit may post AFTER its withdrawal. */
  windowBusinessDays: number;
  /** Max business days a deposit may post BEFORE its withdrawal (banks post on different schedules). */
  maxEarlyBusinessDays: number;
  /** A deposit may be short by up to this much (a fee deducted in flight, e.g. on a wire). */
  feeToleranceCents: number;
  /** Max number of pieces on the "many" side of a split transfer. */
  maxSplitParts: number;
  /** Score at or above which a match is "high confidence" (eligible for one-click bulk accept). */
  highThreshold: number;
  /** Score below which we don't propose at all; the transaction stays unmatched. */
  reviewThreshold: number;
  /** Use exact (optimal) assignment for blocks up to this size; greedy above it. */
  exactAssignmentMaxSize: number;
  /** "exact" (default) or "greedy": exposed so the eval can compare them. */
  assignment: "exact" | "greedy";
};

export const DEFAULT_CONFIG: MatcherConfig = {
  windowBusinessDays: 5,
  maxEarlyBusinessDays: 1,
  feeToleranceCents: 50_00,
  maxSplitParts: 3,
  highThreshold: 0.75,
  reviewThreshold: 0.4,
  exactAssignmentMaxSize: 12,
  assignment: "exact",
};

export type Tier = MatchTier;

/** same_entity: one business's own accounts. intercompany: two businesses. owner: a business and the owner's personal account. */
export type { MatchKind };

export type ProposedMatch = {
  outIds: string[];
  inIds: string[];
  kind: MatchKind;
  score: number; // 0..1
  tier: Tier;
  reasons: string[];
  /** Withdrawal total minus deposit total; > 0 when a fee was deducted in flight. */
  feeCents: number;
  /** Stable identity of the match: sorted transaction ids. */
  legsKey: string;
};

export type MatchInput = {
  transactions: MatchTxn[];
  accounts: AccountInfo[];
  entities: EntityInfo[];
  /** legsKeys a human already rejected; never propose these again. */
  rejectedLegsKeys?: Set<string>;
  config?: Partial<MatcherConfig>;
};

export type MatchStats = {
  candidatePairs: number;
  blocks: number;
  exactBlocks: number;
  greedyBlocks: number;
  splitsFound: number;
};

export type MatchResult = {
  proposals: ProposedMatch[];
  unmatchedIds: string[];
  stats: MatchStats;
};

export const legsKeyOf = (ids: string[]) => [...ids].sort().join(",");
