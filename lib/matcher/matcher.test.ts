import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findTransfers, legsKeyOf, type MatchTxn } from "./index";
import { connectedBlocks, exactAssign, greedyAssign, type Edge } from "./assign";
import { addBusinessDays, businessDaysBetween } from "../dates";

// --- Tiny fixture: two entities, four accounts --------------------------------
const accounts = [
  { id: "a-chk", entityId: "a", last4: "1111" },
  { id: "a-sav", entityId: "a", last4: "2222" },
  { id: "b-chk", entityId: "b", last4: "3333" },
  { id: "b-sav", entityId: "b", last4: "4444" },
];
const entities = [
  { id: "a", name: "Alder Creek Cattle Co." },
  { id: "b", name: "Birchwood Ranch LLC" },
];
let n = 0;
const txn = (accountId: string, postedDate: string, dollars: number, memo: string): MatchTxn => ({
  id: `t${String(++n).padStart(3, "0")}`,
  accountId,
  postedDate,
  amountCents: Math.round(dollars * 100),
  memo,
});
const run = (transactions: MatchTxn[], extra: Partial<Parameters<typeof findTransfers>[0]> = {}) =>
  findTransfers({ transactions, accounts, entities, ...extra });

// 2026-08-03 is a Monday.
const MON = "2026-08-03";

describe("dates", () => {
  it("counts business days, skipping weekends", () => {
    expect(businessDaysBetween("2026-08-07", "2026-08-10")).toBe(1); // Fri -> Mon
    expect(businessDaysBetween(MON, MON)).toBe(0);
    expect(businessDaysBetween("2026-08-10", "2026-08-07")).toBe(-1); // Mon -> previous Fri
    expect(addBusinessDays("2026-08-07", 1)).toBe("2026-08-10");
  });
});

describe("findTransfers: one-to-one", () => {
  it("matches a clear same-entity transfer with high confidence", () => {
    const out = txn("a-chk", MON, -15000, "ONLINE TRANSFER TO SAV ...2222");
    const inn = txn("a-sav", MON, 15000, "ONLINE TRANSFER FROM CHK ...1111");
    const { proposals, unmatchedIds } = run([out, inn]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ outIds: [out.id], inIds: [inn.id], tier: "high", kind: "same_entity" });
    expect(proposals[0].reasons.join(" ")).toContain("...2222");
    expect(unmatchedIds).toEqual([]);
  });

  it("labels transfers between different entities as intercompany", () => {
    const out = txn("a-chk", MON, -40000, "TRANSFER TO BIRCHWOOD RANCH");
    const inn = txn("b-chk", addBusinessDays(MON, 1), 40000, "TRANSFER FROM ALDER CREEK CATTLE");
    const [p] = run([out, inn]).proposals;
    expect(p.kind).toBe("intercompany");
    expect(p.reasons.join(" ")).toContain("Memo names the other entity");
  });

  it("never matches a withdrawal with a deposit on the same account (a bounced transfer)", () => {
    const out = txn("a-chk", MON, -8000, "ONLINE TRANSFER TO SAV ...2222");
    const back = txn("a-chk", addBusinessDays(MON, 1), 8000, "RETURNED TRANSFER ...2222");
    expect(run([out, back]).proposals).toEqual([]);
  });

  it("prefers the real transfer over a same-amount, same-day vendor payment", () => {
    const realOut = txn("a-sav", MON, -5000, "ONLINE TRANSFER TO CHK ...1111");
    const feedBill = txn("b-chk", MON, -5000, "HIGH PLAINS FEED CO INV 7781");
    const inn = txn("a-chk", MON, 5000, "ONLINE TRANSFER FROM SAV ...2222");
    const { proposals, unmatchedIds } = run([realOut, feedBill, inn]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].outIds).toEqual([realOut.id]);
    expect(unmatchedIds).toEqual([feedBill.id]);
  });

  it("does not propose a lookalike with nothing but a matching amount and commerce memos", () => {
    const trucker = txn("b-chk", MON, -3200, "ONLINE TRANSFER TO J HAULING LLC");
    const haySale = txn("a-sav", addBusinessDays(MON, 1), 3200, "HAY SALE DEPOSIT");
    expect(run([trucker, haySale]).proposals).toEqual([]);
  });

  it("sends bland-memo transfers to review instead of auto-accepting them", () => {
    const out = txn("a-chk", MON, -12500, "WITHDRAWAL");
    const inn = txn("b-chk", addBusinessDays(MON, 1), 12500, "DEPOSIT");
    expect(run([out, inn]).proposals[0].tier).toBe("review");
  });

  it("handles a wire fee: amounts differ, fee recorded, always needs review", () => {
    const out = txn("a-chk", MON, -75000, "WIRE TRANSFER OUT BIRCHWOOD RANCH REF 88412");
    const inn = txn("b-chk", MON, 74985, "INCOMING WIRE ALDER CREEK REF 88412");
    const [p] = run([out, inn]).proposals;
    expect(p.feeCents).toBe(1500);
    expect(p.tier).toBe("review");
    expect(p.reasons.join(" ")).toContain("88412");
  });

  it("allows a deposit to post one business day BEFORE the withdrawal, but not two", () => {
    const out = txn("a-sav", MON, -10000, "ONLINE TRANSFER TO CHK ...1111");
    const oneEarly = txn("a-chk", addBusinessDays(MON, -1), 10000, "ONLINE TRANSFER FROM SAV ...2222");
    expect(run([out, oneEarly]).proposals).toHaveLength(1);

    const out2 = txn("a-sav", MON, -10000, "ONLINE TRANSFER TO CHK ...1111");
    const twoEarly = txn("a-chk", addBusinessDays(MON, -2), 10000, "ONLINE TRANSFER FROM SAV ...2222");
    expect(run([out2, twoEarly]).proposals).toHaveLength(0);
  });

  it("respects the date window", () => {
    const out = txn("a-chk", MON, -16000, "TRANSFER TO BIRCHWOOD RANCH");
    const inn = txn("b-chk", addBusinessDays(MON, 4), 16000, "TRANSFER FROM ALDER CREEK CATTLE");
    expect(run([out, inn], { config: { windowBusinessDays: 3 } }).proposals).toHaveLength(0);
    expect(run([out, inn], { config: { windowBusinessDays: 5 } }).proposals).toHaveLength(1);
  });

  it("never re-proposes a match a human rejected", () => {
    const out = txn("a-chk", MON, -15000, "ONLINE TRANSFER TO SAV ...2222");
    const inn = txn("a-sav", MON, 15000, "ONLINE TRANSFER FROM CHK ...1111");
    const rejected = new Set([legsKeyOf([out.id, inn.id])]);
    expect(run([out, inn], { rejectedLegsKeys: rejected }).proposals).toEqual([]);
  });
});

describe("findTransfers: splits", () => {
  it("finds one withdrawal landing as two deposits", () => {
    const out = txn("a-chk", MON, -50000, "TRANSFER TO BIRCHWOOD RANCH");
    const in1 = txn("b-chk", addBusinessDays(MON, 1), 30000, "TRANSFER FROM ALDER CREEK CATTLE");
    const in2 = txn("b-sav", addBusinessDays(MON, 1), 20000, "TRANSFER FROM ALDER CREEK CATTLE");
    const [p] = run([out, in1, in2]).proposals;
    expect(p.outIds).toEqual([out.id]);
    expect([...p.inIds].sort()).toEqual([in1.id, in2.id].sort());
    expect(p.tier).toBe("review"); // splits always get a human look
  });

  it("finds two withdrawals landing as one deposit", () => {
    const out1 = txn("a-chk", MON, -9000, "TRANSFER TO BIRCHWOOD RANCH");
    const out2 = txn("a-sav", MON, -6000, "TRANSFER TO BIRCHWOOD RANCH");
    const inn = txn("b-chk", addBusinessDays(MON, 1), 15000, "TRANSFER FROM ALDER CREEK CATTLE");
    const [p] = run([out1, out2, inn]).proposals;
    expect([...p.outIds].sort()).toEqual([out1.id, out2.id].sort());
    expect(p.inIds).toEqual([inn.id]);
  });
});

describe("assignment", () => {
  // Two identical $2,500 transfers two days apart (Mon -> Wed, Wed -> Fri).
  const edges: Edge[] = [
    { outId: "out1_mon", inId: "in1_wed", score: 0.515 },
    { outId: "out2_wed", inId: "in2_fri", score: 0.515 },
    { outId: "out2_wed", inId: "in1_wed", score: 0.65 }, // same day: looks best in isolation
  ];

  it("greedy grabs the locally-best pair and orphans the rest", () => {
    expect(greedyAssign(edges).map((e) => `${e.outId}-${e.inId}`)).toEqual(["out2_wed-in1_wed"]);
  });

  it("exact assignment finds the globally-best pairing", () => {
    const chosen = exactAssign(edges).map((e) => `${e.outId}-${e.inId}`).sort();
    expect(chosen).toEqual(["out1_mon-in1_wed", "out2_wed-in2_fri"]);
  });

  it("splits unrelated candidates into separate blocks", () => {
    const blocks = connectedBlocks([...edges, { outId: "x", inId: "y", score: 0.9 }]);
    expect(blocks.map((b) => b.length).sort()).toEqual([1, 3]);
  });
});

describe("invariants on the full synthetic feed", () => {
  const feed = JSON.parse(readFileSync(join(__dirname, "../../data/bank_feed.json"), "utf8"));
  const transactions: MatchTxn[] = feed.transactions.map((t: any) => ({
    id: t.providerTxnId, accountId: t.accountId, postedDate: t.postedDate, amountCents: t.amountCents, memo: t.memo,
  }));
  const realAccounts = [
    { id: "cedar-chk", entityId: "cedar", last4: "4821" },
    { id: "cedar-sav", entityId: "cedar", last4: "7730" },
    { id: "hollis-chk", entityId: "hollis", last4: "1956" },
    { id: "hollis-sav", entityId: "hollis", last4: "3307" },
  ];
  const realEntities = [
    { id: "cedar", name: "Cedar Creek Cattle Co." },
    { id: "hollis", name: "Hollis Ranch LLC" },
  ];
  const result = findTransfers({ transactions, accounts: realAccounts, entities: realEntities });

  it("never uses a transaction in two proposals", () => {
    const ids = result.proposals.flatMap((p) => [...p.outIds, ...p.inIds]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every transaction is either in exactly one proposal or unmatched", () => {
    const proposed = result.proposals.flatMap((p) => [...p.outIds, ...p.inIds]);
    expect(proposed.length + result.unmatchedIds.length).toBe(transactions.length);
  });

  it("is deterministic regardless of input order", () => {
    const shuffled = [...transactions].reverse();
    const again = findTransfers({ transactions: shuffled, accounts: realAccounts, entities: realEntities });
    expect(again.proposals).toEqual(result.proposals);
  });

  it("keeps high-tier precision at 100% on the labelled feed (regression guard)", () => {
    const truth = JSON.parse(readFileSync(join(__dirname, "../../data/ground_truth.json"), "utf8"));
    const truthKeys = new Set(truth.groups.map((g: any) => legsKeyOf([...g.outs, ...g.ins])));
    const high = result.proposals.filter((p) => p.tier === "high");
    expect(high.length).toBeGreaterThan(0);
    expect(high.filter((p) => !truthKeys.has(p.legsKey))).toEqual([]);
  });
});
