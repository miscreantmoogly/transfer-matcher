// Grades the matcher against the synthetic feed's answer key, case by case.
// Powers the internal "Matcher diagnostics" page. Read-only: it runs the pure
// matcher in memory and never touches the database or the books.

import type { MatchKind } from "./domain";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findTransfers, legsKeyOf, type ProposedMatch } from "./matcher";
import { BANK_ACCOUNTS, ENTITIES } from "./org";

type FeedRow = { providerTxnId: string; accountId: string; postedDate: string; amountCents: number; memo: string; batch: number };
type TruthGroup = { id: string; kind: MatchKind; difficulty: "easy" | "medium" | "hard"; label: string; outs: string[]; ins: string[] };
type Trap = { id: string; label: string; txns: string[] };

export type CaseLeg = {
  accountName: string;
  last4: string;
  entityName: string;
  postedDate: string;
  amountCents: number;
  memo: string;
};

export type TransferCase = {
  id: string;
  label: string;
  kind: MatchKind;
  difficulty: "easy" | "medium" | "hard";
  legs: CaseLeg[];
  /** strong / check = found exactly; missed = not proposed; wrong = proposed, but grouped with the wrong transactions */
  outcome: "strong" | "check" | "missed" | "wrong";
  score: number | null;
};

export type TrapCase = {
  id: string;
  label: string;
  legs: CaseLeg[];
  outcome: "ignored" | "proposed";
  tier: "high" | "review" | null;
  score: number | null;
};

export type Diagnostics = {
  totals: {
    transactions: number;
    transfers: number;
    transfersFound: number;
    traps: number;
    trapsIgnored: number;
    ordinary: number;
    ordinaryLeftAlone: number;
    strongProposed: number;
    strongCorrect: number;
    checkProposed: number;
    checkCorrect: number;
  };
  transfers: TransferCase[];
  traps: TrapCase[];
  ordinary: (CaseLeg & { proposed: boolean })[];
};

export function runDiagnostics(): Diagnostics {
  const dir = join(process.cwd(), "data");
  const feed: { transactions: FeedRow[] } = JSON.parse(readFileSync(join(dir, "bank_feed.json"), "utf8"));
  const truth: { groups: TruthGroup[]; traps: Trap[] } = JSON.parse(readFileSync(join(dir, "ground_truth.json"), "utf8"));

  const result = findTransfers({
    transactions: feed.transactions.map((t) => ({
      id: t.providerTxnId,
      accountId: t.accountId,
      postedDate: t.postedDate,
      amountCents: t.amountCents,
      memo: t.memo,
    })),
    accounts: BANK_ACCOUNTS.map((a) => ({ id: a.id, entityId: a.entityId, last4: a.last4 })),
    entities: ENTITIES.map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
  });

  const byId = new Map(feed.transactions.map((t) => [t.providerTxnId, t]));
  const leg = (id: string): CaseLeg => {
    const t = byId.get(id)!;
    const a = BANK_ACCOUNTS.find((x) => x.id === t.accountId)!;
    return {
      accountName: a.name,
      last4: a.last4,
      entityName: ENTITIES.find((e) => e.id === a.entityId)!.name,
      postedDate: t.postedDate,
      amountCents: t.amountCents,
      memo: t.memo,
    };
  };

  const proposalByKey = new Map(result.proposals.map((p) => [p.legsKey, p]));
  const proposalByTxn = new Map<string, ProposedMatch>();
  for (const p of result.proposals) for (const id of [...p.outIds, ...p.inIds]) proposalByTxn.set(id, p);

  const truthKeys = new Set(truth.groups.map((g) => legsKeyOf([...g.outs, ...g.ins])));
  const strong = result.proposals.filter((p) => p.tier === "high");
  const check = result.proposals.filter((p) => p.tier === "review");

  const transfers: TransferCase[] = truth.groups.map((g) => {
    const exact = proposalByKey.get(legsKeyOf([...g.outs, ...g.ins]));
    const touched = [...g.outs, ...g.ins].some((id) => proposalByTxn.has(id));
    return {
      id: g.id,
      label: g.label,
      kind: g.kind,
      difficulty: g.difficulty,
      legs: [...g.outs, ...g.ins].map(leg),
      outcome: exact ? (exact.tier === "high" ? "strong" : "check") : touched ? "wrong" : "missed",
      score: exact?.score ?? null,
    };
  });

  const traps: TrapCase[] = truth.traps.map((t) => {
    const hit = t.txns.map((id) => proposalByTxn.get(id)).find(Boolean) ?? null;
    return {
      id: t.id,
      label: t.label,
      legs: t.txns.map(leg),
      outcome: hit ? "proposed" : "ignored",
      tier: hit?.tier ?? null,
      score: hit?.score ?? null,
    };
  });

  const special = new Set([...truth.groups.flatMap((g) => [...g.outs, ...g.ins]), ...truth.traps.flatMap((t) => t.txns)]);
  const ordinary = feed.transactions
    .filter((t) => !special.has(t.providerTxnId))
    .map((t) => ({ ...leg(t.providerTxnId), proposed: proposalByTxn.has(t.providerTxnId) }));

  return {
    totals: {
      transactions: feed.transactions.length,
      transfers: transfers.length,
      transfersFound: transfers.filter((c) => c.outcome === "strong" || c.outcome === "check").length,
      traps: traps.length,
      trapsIgnored: traps.filter((t) => t.outcome === "ignored").length,
      ordinary: ordinary.length,
      ordinaryLeftAlone: ordinary.filter((o) => !o.proposed).length,
      strongProposed: strong.length,
      strongCorrect: strong.filter((p) => truthKeys.has(p.legsKey)).length,
      checkProposed: check.length,
      checkCorrect: check.filter((p) => truthKeys.has(p.legsKey)).length,
    },
    transfers,
    traps,
    ordinary,
  };
}
