// Scoring: how confident are we that these withdrawals and deposits are the
// same money moving between two of the customer's own accounts?
//
// Deliberately a hand-weighted, additive score rather than a trained model:
//   * every point is explainable ("memo references ...4821"), which a reviewer
//     and an auditor both need;
//   * there's no labelled production data yet to train on. Once reviewers have
//     accepted/rejected thousands of proposals, those decisions ARE the
//     training set, and these weights become the baseline to beat.

import { businessDaysBetween } from "../dates";
import {
  hasTransferWords,
  isRoundHundreds,
  looksLikeCommerce,
  mentionsEntity,
  mentionsLast4,
  pointsElsewhere,
  sharedReferences,
} from "./signals";
import type { AccountInfo, EntityInfo, MatchKind, MatchTxn, MatcherConfig, Tier } from "./types";

export const WEIGHTS = {
  date: 0.45, // multiplied by a 0..1 date-closeness score
  exactAmount: 0.1,
  roundAmount: 0.1,
  transferWordsOut: 0.1,
  transferWordsIn: 0.1,
  mentionsOtherAccount: 0.3,
  mentionsOtherEntity: 0.25,
  sharedReference: 0.3,
  commercePenalty: -0.35, // per leg that looks like a real purchase or sale
  pointsElsewherePenalty: -0.3,
  namesElsewherePenalty: -0.3,
  splitPenalty: -0.1,
};

/** Closeness of posting dates. `gap` = signed business days from withdrawal to deposit. */
export function dateCloseness(gap: number): number {
  if (gap < 0) return 0.7; // deposit posted first: happens, but a bit suspicious
  return [1, 0.85, 0.7, 0.55, 0.4, 0.3][gap] ?? 0.2;
}

export type Lookup = {
  account: (id: string) => AccountInfo;
  entity: (id: string) => EntityInfo;
  /** Every account number the customer has connected (for spotting memos that point elsewhere). */
  allLast4s?: string[];
  /** Every entity the customer has (for spotting memos that name a business outside this match). */
  allEntities?: EntityInfo[];
};

export type GroupScore = {
  score: number;
  reasons: string[];
  feeCents: number;
  kind: MatchKind;
  /** Some matches always go to a human, however high they score. */
  mustReview: boolean;
};

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Scores a candidate match: one-to-one, one-to-many, or many-to-one. */
export function scoreGroup(outs: MatchTxn[], ins: MatchTxn[], lookup: Lookup): GroupScore {
  const reasons: string[] = [];
  let points = 0;
  let mustReview = false;

  const outAccounts = outs.map((t) => lookup.account(t.accountId));
  const inAccounts = ins.map((t) => lookup.account(t.accountId));
  const entityIds = new Set([...outAccounts, ...inAccounts].map((a) => a.entityId));
  const kind: MatchKind = [...entityIds].some((id) => lookup.entity(id).kind === "personal")
    ? "owner"
    : entityIds.size > 1
      ? "intercompany"
      : "same_entity";

  // --- Timing: use the WORST pair, so one far-off leg can't hide in an average.
  let worstCloseness = 1;
  let worstGap = 0;
  for (const o of outs) {
    for (const i of ins) {
      const gap = businessDaysBetween(o.postedDate, i.postedDate);
      const c = dateCloseness(gap);
      if (c < worstCloseness || (c === worstCloseness && Math.abs(gap) > Math.abs(worstGap))) {
        worstCloseness = c;
        worstGap = gap;
      }
    }
  }
  points += WEIGHTS.date * worstCloseness;
  reasons.push(
    worstGap === 0
      ? "Posted the same business day"
      : worstGap > 0
        ? `Deposit posted ${worstGap} business day${worstGap > 1 ? "s" : ""} after the withdrawal`
        : `Deposit posted ${-worstGap} business day BEFORE the withdrawal`,
  );

  // --- Amounts
  const outTotal = -outs.reduce((s, t) => s + t.amountCents, 0);
  const inTotal = ins.reduce((s, t) => s + t.amountCents, 0);
  const feeCents = outTotal - inTotal;
  if (feeCents === 0) {
    points += WEIGHTS.exactAmount;
    reasons.push(`Amounts match exactly (${dollars(outTotal)})`);
  } else {
    mustReview = true;
    reasons.push(`Deposit is ${dollars(feeCents)} short of the withdrawal (likely a fee taken in flight)`);
  }
  if (isRoundHundreds(outTotal)) {
    points += WEIGHTS.roundAmount;
    reasons.push("Round-number amount (transfers usually are; purchases rarely are)");
  }

  // --- Memo wording
  if (outs.some((t) => hasTransferWords(t.memo))) {
    points += WEIGHTS.transferWordsOut;
    reasons.push("Withdrawal memo says transfer/wire");
  }
  if (ins.some((t) => hasTransferWords(t.memo))) {
    points += WEIGHTS.transferWordsIn;
    reasons.push("Deposit memo says transfer/wire");
  }

  // --- Does either side name the other side's account?
  const outRefsIn = inAccounts.find((a) => outs.some((t) => mentionsLast4(t.memo, a.last4)));
  const inRefsOut = outAccounts.find((a) => ins.some((t) => mentionsLast4(t.memo, a.last4)));
  if (outRefsIn || inRefsOut) {
    points += WEIGHTS.mentionsOtherAccount;
    reasons.push(`Memo references the other account (...${(outRefsIn ?? inRefsOut)!.last4})`);
  }

  // --- Different entities: does either side name the other one?
  if (kind !== "same_entity") {
    const inEntities = [...new Set(inAccounts.map((a) => a.entityId))].map(lookup.entity);
    const outEntities = [...new Set(outAccounts.map((a) => a.entityId))].map(lookup.entity);
    const named =
      inEntities.find((e) => outs.some((t) => mentionsEntity(t.memo, e))) ??
      outEntities.find((e) => ins.some((t) => mentionsEntity(t.memo, e)));
    if (named) {
      points += WEIGHTS.mentionsOtherEntity;
      reasons.push(`Memo names the other entity (${named.name})`);
    }
  }

  // --- A reference number on both sides (e.g. a wire's REF 88412)
  const allLast4s = [...outAccounts, ...inAccounts].map((a) => a.last4);
  const refs = outs.flatMap((o) => ins.flatMap((i) => sharedReferences(o.memo, i.memo, allLast4s)));
  if (refs.length > 0) {
    points += WEIGHTS.sharedReference;
    reasons.push(`Both memos carry reference ${refs[0]}`);
  }

  // --- Evidence AGAINST
  for (const t of [...outs, ...ins]) {
    if (looksLikeCommerce(t.memo, t.amountCents)) {
      points += WEIGHTS.commercePenalty;
      reasons.push(`"${t.memo}" looks like a real ${t.amountCents < 0 ? "purchase" : "sale"}, not a transfer`);
    }
    const elsewhere = (lookup.allEntities ?? []).find((e) => !entityIds.has(e.id) && mentionsEntity(t.memo, e));
    if (elsewhere) {
      points += WEIGHTS.namesElsewherePenalty;
      reasons.push(`"${t.memo}" names ${elsewhere.name}, which isn't part of this match`);
    }
    if (pointsElsewhere(t.memo, allLast4s, lookup.allLast4s)) {
      points += WEIGHTS.pointsElsewherePenalty;
      reasons.push(`"${t.memo}" points to a different account`);
    }
  }

  // --- Splits: plausible but riskier, and a human should confirm the grouping.
  if (outs.length + ins.length > 2) {
    points += WEIGHTS.splitPenalty;
    mustReview = true;
    reasons.push(`Split transfer: ${outs.length} withdrawal(s) -> ${ins.length} deposit(s)`);
  }

  const score = Math.round(Math.min(1, Math.max(0, points)) * 1000) / 1000;
  return { score, reasons, feeCents, kind, mustReview };
}

export function tierFor(s: GroupScore, config: MatcherConfig): Tier | null {
  if (s.score < config.reviewThreshold) return null;
  if (s.score >= config.highThreshold && !s.mustReview) return "high";
  return "review";
}
