// Integration tests: real SQLite (in memory), real services, real schema.

import { beforeEach, describe, expect, it } from "vitest";
import { createFreshDb, resetData, type DB } from "../db";
import { loadUser } from "../auth";
import { syncBatch, loadFeed } from "./demo";
import { importTransactions } from "./import";
import { runMatching } from "./matchRun";
import { claimNext, complete, enqueue, fail } from "./jobs";
import { acceptProposal, bulkAccept, listProposals, manualMatch, rejectProposal, undoProposal } from "./proposals";
import { booksSummary, recentAudit, unmatchedTransactions } from "./books";
import { consolidate, decideSale } from "./consolidation";
import { postEntry } from "./ledger";
import { preflight } from "./preflight";

let db: DB;
const wes = () => loadUser(db, "wes");
const dana = () => loadUser(db, "dana");

beforeEach(() => {
  db = createFreshDb(":memory:");
});

const syncAndMatch = (batch = 1) => {
  syncBatch(db, batch, "test");
  return runMatching(db, "test");
};

describe("import", () => {
  it("is idempotent: re-importing the same feed adds nothing", () => {
    const first = syncBatch(db, 1, "test");
    const second = syncBatch(db, 1, "test");
    expect(first.inserted).toBeGreaterThan(100);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(first.received);
  });

  it("books every transaction with a balanced entry, and enqueues one debounced job", () => {
    syncBatch(db, 1, "test");
    syncBatch(db, 2, "test");
    expect((db.prepare("SELECT count(*) AS n FROM unbalanced_entries").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'queued'").get() as { n: number }).n).toBe(1);
  });

  it("rolls back everything if one row is bad (no half-imports, no orphan job)", () => {
    const rows = loadFeed().transactions.slice(0, 3);
    const bad = { ...rows[2], accountId: "no-such-account" };
    expect(() => importTransactions(db, [rows[0], rows[1], bad], "test")).toThrow();
    expect((db.prepare("SELECT count(*) AS n FROM bank_transactions").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }).n).toBe(0);
  });
});

describe("matching runs", () => {
  it("creates proposals, and a second run with no new data changes nothing", () => {
    const first = syncAndMatch();
    expect(first.created).toBeGreaterThan(20);
    const again = runMatching(db, "test");
    expect(again).toMatchObject({ created: 0, superseded: 0, updated: 0, kept: first.created });
  });

  it("picks up a late counterpart when the next bank sync arrives", () => {
    syncAndMatch(1);
    const waiting = unmatchedTransactions(db, wes()).filter((t) => t.awaitingCounterpart);
    expect(waiting.some((t) => t.memo === "TRANSFER TO CEDAR CREEK CATTLE")).toBe(true);

    syncAndMatch(2);
    const open = listProposals(db, wes(), ["proposed"]);
    expect(open.some((p) => p.legs.some((l) => l.memo === "TRANSFER FROM HOLLIS RANCH" && l.postedDate === "2026-09-28"))).toBe(true);
  });
});

describe("accepting a proposal", () => {
  it("removes fake income and keeps intercompany balances netting to zero", () => {
    syncAndMatch();
    const before = booksSummary(db, wes());
    const all = listProposals(db, wes(), ["proposed"]);
    for (const p of all) acceptProposal(db, wes(), p.id, p.version);
    const after = booksSummary(db, wes());

    const income = (s: typeof before) => s.entities.reduce((x, e) => x + e.incomeNowCents, 0);
    expect(income(after)).toBeLessThan(income(before));
    expect(after.intercompanyNetCents).toBe(0);
    expect(after.unbalancedEntries).toBe(0);
    for (const e of after.entities) expect(e.transfersInTransitCents).toBe(0);
  });

  it("refuses a stale version (optimistic locking) and a double accept", () => {
    syncAndMatch();
    const [p] = listProposals(db, wes(), ["proposed"]);
    acceptProposal(db, wes(), p.id, p.version);
    expect(() => acceptProposal(db, wes(), p.id, p.version)).toThrow(/changed since you loaded it/);
  });

  it("hides cross-entity proposals from a user who can't see both entities", () => {
    syncAndMatch();
    const forWes = listProposals(db, wes(), ["proposed"]);
    const forDana = listProposals(db, dana(), ["proposed"]);
    const intercompany = forWes.find((p) => p.kind === "intercompany")!;
    expect(forDana.every((p) => p.legs.every((l) => l.entityId === "hollis"))).toBe(true);
    expect(() => acceptProposal(db, dana(), intercompany.id, intercompany.version)).toThrow(/not found/);
  });

  it("bulk accept reports per-item results instead of failing the whole batch", () => {
    syncAndMatch();
    const [a, b] = listProposals(db, wes(), ["proposed"]);
    const results = bulkAccept(db, wes(), [
      { id: a.id, version: a.version },
      { id: b.id, version: b.version + 99 }, // stale
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });
});

describe("pre-flight checks", () => {
  it("all pass for an ordinary proposal", () => {
    syncAndMatch();
    const [p] = listProposals(db, wes(), ["proposed"]);
    expect(preflight(db, wes(), p).every((c) => c.ok)).toBe(true);
  });

  it("block accepting into a closed period, even with a valid version", () => {
    syncAndMatch();
    const p = listProposals(db, wes(), ["proposed"]).find((x) => x.legs.every((l) => l.entityId === "cedar"))!;
    db.prepare("UPDATE entities SET books_closed_through = '2026-12-31' WHERE id = 'cedar'").run();
    expect(preflight(db, wes(), p).find((c) => c.id === "period")!.ok).toBe(false);
    expect(() => acceptProposal(db, wes(), p.id, p.version)).toThrow(/Pre-flight check failed/);
  });
});

describe("owner's personal account", () => {
  it("books a draw as equity on the business, never as an expense", () => {
    syncAndMatch();
    const before = booksSummary(db, wes());
    const draw = listProposals(db, wes(), ["proposed"]).find((p) => p.kind === "owner" && p.totalCents === 350000)!;
    acceptProposal(db, wes(), draw.id, draw.version);
    const after = booksSummary(db, wes());
    const cedar = (s: typeof before) => s.entities.find((e) => e.entityId === "cedar")!;
    expect(cedar(after).ownerDrawsCents).toBe(350000);
    expect(cedar(before).expenseNowCents - cedar(after).expenseNowCents).toBe(350000);
    expect(after.entities.some((e) => e.entityId === "wes")).toBe(false); // personal isn't business books
    expect(after.unbalancedEntries).toBe(0);
  });
});

describe("reject and undo", () => {
  it("a rejected match is never proposed again", () => {
    syncAndMatch();
    const [p] = listProposals(db, wes(), ["proposed"]);
    rejectProposal(db, wes(), p.id, p.version, "not a transfer");
    runMatching(db, "test");
    const again = listProposals(db, wes(), ["proposed"]);
    const key = (x: typeof p) => x.legs.map((l) => l.transactionId).sort().join(",");
    expect(again.some((x) => key(x) === key(p))).toBe(false);
  });

  it("undo posts reversing entries and restores the books exactly", () => {
    syncAndMatch();
    const before = booksSummary(db, wes());
    const [p] = listProposals(db, wes(), ["proposed"]);
    const applied = acceptProposal(db, wes(), p.id, p.version);
    undoProposal(db, wes(), applied.id, applied.version);
    const after = booksSummary(db, wes());
    expect(after.entities).toEqual(before.entities);
    // Nothing was deleted: the original match entries are still there, plus their reversals.
    const n = (db.prepare("SELECT count(*) AS n FROM journal_entries WHERE proposal_id = ?").get(p.id) as { n: number }).n;
    expect(n).toBe(2 * p.legs.length);
  });
});

describe("manual match", () => {
  it("lets a human match the paper check the matcher missed", () => {
    syncAndMatch();
    const unmatched = unmatchedTransactions(db, wes());
    const check = unmatched.find((t) => t.memo === "CHECK #1042")!;
    const deposit = unmatched.find((t) => t.memo === "MOBILE DEPOSIT" && t.amountCents === 235000)!;
    const p = manualMatch(db, wes(), [check.id, deposit.id]);
    expect(p).toMatchObject({ status: "applied", source: "manual", kind: "intercompany" });
    expect(booksSummary(db, wes()).intercompanyNetCents).toBe(0);
  });

  it("rejects transactions that don't add up", () => {
    syncAndMatch();
    const [a, b] = unmatchedTransactions(db, wes()).filter((t) => t.amountCents < 0);
    expect(() => manualMatch(db, wes(), [a.id, b.id])).toThrow(/withdrawal and one deposit/);
  });
});

describe("database-enforced invariants", () => {
  it("a transaction can't be in two live matches, even if app code tried", () => {
    syncAndMatch();
    const [p] = listProposals(db, wes(), ["proposed"]);
    const txnId = p.legs[0].transactionId;
    const other = db.prepare(
      "INSERT INTO match_proposals (status, kind, source, tier, confidence, reasons, legs_key) VALUES ('proposed','same_entity','manual','review',1,'[]','x')",
    ).run().lastInsertRowid;
    expect(() =>
      db.prepare("INSERT INTO match_legs (proposal_id, transaction_id, direction, active) VALUES (?, ?, 'out', 1)").run(other, txnId),
    ).toThrow(/UNIQUE/);
  });
});

describe("job queue", () => {
  it("debounces: many enqueues, one queued job", () => {
    for (let i = 0; i < 5; i++) enqueue(db, "match_transfers", "k", 0);
    expect((db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'queued'").get() as { n: number }).n).toBe(1);
  });

  it("claims each job once, retries failures with backoff, then gives up", () => {
    enqueue(db, "match_transfers", "k", 0);
    const job = claimNext(db)!;
    expect(claimNext(db)).toBeUndefined(); // nobody else gets it
    fail(db, job, new Error("boom"));
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(job.id) as { status: string; run_after: string };
    expect(row.status).toBe("queued");
    expect(row.run_after > new Date().toISOString()).toBe(true); // backed off
    db.prepare("UPDATE jobs SET run_after = ? WHERE id = ?").run(new Date(0).toISOString(), job.id);
    const j2 = claimNext(db)!;
    fail(db, j2, new Error("boom"));
    db.prepare("UPDATE jobs SET run_after = ? WHERE id = ?").run(new Date(0).toISOString(), job.id);
    const j3 = claimNext(db)!;
    fail(db, j3, new Error("boom"));
    expect((db.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string }).status).toBe("failed");
  });

  it("completes jobs", () => {
    enqueue(db, "match_transfers", "k", 0);
    const job = claimNext(db)!;
    complete(db, job, { ok: true });
    expect((db.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string }).status).toBe("done");
  });
});

describe("consolidated statements", () => {
  const acceptAll = () => {
    for (const p of listProposals(db, wes(), ["proposed"])) acceptProposal(db, wes(), p.id, p.version);
  };
  const confirmAllSales = () => {
    for (const s of consolidate(db, wes()).sales) decideSale(db, wes(), s.buyer.transactionId, s.seller.transactionId, "confirmed");
  };
  const balances = (c: ReturnType<typeof consolidate>) => {
    for (const col of c.columns) expect(c.assets.total.byEntity[col.id]).toBe(c.liabilitiesAndEquity.byEntity[col.id]);
    expect(c.assets.total.consolidatedCents).toBe(c.liabilitiesAndEquity.consolidatedCents);
  };

  it("balances for every business and for the group, at every stage of review", () => {
    syncAndMatch();
    balances(consolidate(db, wes()));
    acceptAll();
    balances(consolidate(db, wes()));
    confirmAllSales();
    balances(consolidate(db, wes()));
  });

  it("eliminates what the businesses owe each other, leaving cash untouched", () => {
    syncAndMatch();
    const cashBefore = consolidate(db, wes()).assets.lines.find((l) => l.key === "cash")!.consolidatedCents;
    acceptAll();
    const c = consolidate(db, wes());
    const owed = [...c.assets.lines, ...c.liabilities.lines].filter((l) => l.key.startsWith("due_"));
    expect(owed.length).toBeGreaterThan(0);
    for (const l of owed) {
      expect(l.eliminationCents).not.toBe(0);
      expect(l.consolidatedCents).toBe(0);
    }
    expect(c.assets.lines.find((l) => l.key === "cash")!.consolidatedCents).toBe(cashBefore);
    expect(c.readiness.find((r) => r.id === "intercompany")!.ok).toBe(true);
  });

  it("keeps balances with a business that's left out: to the group it's an outside party", () => {
    syncAndMatch();
    acceptAll();
    const c = consolidate(db, wes(), ["cedar", "land"]);
    const dueFromHollis = c.assets.lines.find((l) => l.key === "due_from:hollis")!;
    expect(dueFromHollis.consolidatedCents).toBeGreaterThan(0);
    expect(dueFromHollis.eliminationCents).toBe(0);
    balances(c);
  });

  it("finds the rent and hay paid between the businesses, and not look-alikes from outsiders", () => {
    syncAndMatch();
    const sales = consolidate(db, wes()).sales;
    expect(sales).toHaveLength(7); // 3 months of rent to the Land Co. from each ranch, plus one hay sale (X7-X9)
    expect(sales.every((s) => s.status === "pending")).toBe(true);
    expect(sales.some((s) => /R MILLER/.test(s.buyer.memo))).toBe(false); // X6: rent paid to a neighbor
  });

  it("removes intercompany sales from revenue and expenses without changing profit", () => {
    syncAndMatch();
    acceptAll();
    const before = consolidate(db, wes());
    confirmAllSales();
    const after = consolidate(db, wes());
    const removed = after.sales.reduce((s, x) => s + x.seller.amountCents, 0);
    expect(removed).toBe(1_840_000);
    expect(after.income.total.consolidatedCents).toBe(before.income.total.consolidatedCents - removed);
    expect(after.expenses.total.consolidatedCents).toBe(before.expenses.total.consolidatedCents - removed);
    expect(after.netIncome.consolidatedCents).toBe(before.netIncome.consolidatedCents);
    // Each business's own books are untouched.
    for (const col of after.columns) expect(after.income.total.byEntity[col.id]).toBe(before.income.total.byEntity[col.id]);
  });

  it("isn't ready until transfers are reviewed and sales decided", () => {
    syncAndMatch();
    const blocked = (c: ReturnType<typeof consolidate>) => c.readiness.filter((r) => !r.ok && r.severity === "block").map((r) => r.id);
    expect(blocked(consolidate(db, wes()))).toEqual(["transfers", "sales"]);
    acceptAll();
    expect(blocked(consolidate(db, wes()))).toEqual(["sales"]);
    confirmAllSales();
    const c = consolidate(db, wes());
    expect(c.ready).toBe(true);
    expect(c.readiness.find((r) => r.id === "unexplained")!.severity).toBe("warn"); // still worth a look, but not blocking
  });

  it("flags businesses that disagree about what's owed", () => {
    syncAndMatch();
    // A one-sided entry, like a manual journal entry booked on only one business.
    postEntry(db, {
      entityId: "cedar",
      entryDate: "2026-09-30",
      source: "transfer_match",
      memo: "One-sided loan",
      createdBy: "test",
      lines: [
        { ledgerAccountId: "cedar:due_from_hollis", debit: 100_000 },
        { ledgerAccountId: "cedar:opening_equity", credit: 100_000 },
      ],
    });
    const check = consolidate(db, wes()).readiness.find((r) => r.id === "intercompany")!;
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("Hollis Ranch LLC");
  });

  it("won't let a confirmed sale be matched as a transfer", () => {
    syncAndMatch();
    const sale = consolidate(db, wes()).sales[0];
    decideSale(db, wes(), sale.buyer.transactionId, sale.seller.transactionId, "confirmed");
    expect(() => manualMatch(db, wes(), [sale.buyer.transactionId, sale.seller.transactionId])).toThrow(/confirmed as a sale/);
  });

  it("keeps opening balances through a demo reset", () => {
    syncAndMatch();
    const opening = consolidate(db, wes()).equity.lines.find((l) => l.key === "opening_equity")!.consolidatedCents;
    resetData(db);
    const c = consolidate(db, wes());
    expect(c.assets.lines.find((l) => l.key === "cash")!.consolidatedCents).toBe(opening);
    balances(c);
  });

  it("only shows and acts on businesses the user can see, and keeps the decision out of their activity log", () => {
    syncAndMatch();
    const sale = consolidate(db, wes()).sales.find((s) => s.buyer.entityId === "cedar" && s.seller.entityId === "land")!;
    expect(() => decideSale(db, dana(), sale.buyer.transactionId, sale.seller.transactionId, "confirmed")).toThrow(/not found/);
    expect(() => consolidate(db, dana(), ["cedar"])).toThrow(/not found/);
    const hers = consolidate(db, dana());
    expect(hers.columns.map((c) => c.id)).toEqual(["hollis"]);
    expect(hers.sales).toHaveLength(0);

    decideSale(db, wes(), sale.buyer.transactionId, sale.seller.transactionId, "confirmed");
    expect(recentAudit(db, wes(), 50).some((a) => a.action === "sale_confirmed")).toBe(true);
    expect(recentAudit(db, dana(), 50).some((a) => a.action === "sale_confirmed")).toBe(false);
  });
});
