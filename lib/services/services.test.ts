// Integration tests: real SQLite (in memory), real services, real schema.

import { beforeEach, describe, expect, it } from "vitest";
import { createFreshDb, type DB } from "../db";
import { loadUser } from "../auth";
import { syncBatch, loadFeed } from "./demo";
import { importTransactions } from "./import";
import { runMatching } from "./matchRun";
import { claimNext, complete, enqueue, fail } from "./jobs";
import { acceptProposal, bulkAccept, listProposals, manualMatch, rejectProposal, undoProposal } from "./proposals";
import { booksSummary, unmatchedTransactions } from "./books";

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
