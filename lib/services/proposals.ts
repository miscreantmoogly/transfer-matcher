// Human decisions on match proposals: accept (apply to the books), reject,
// undo, bulk accept, and manual matches for what the matcher missed.
//
// Every write here:
//   * checks permission (the user must see every entity the match touches),
//   * uses optimistic locking: the client sends the version it was looking
//     at; if the proposal changed since (re-scored, superseded, accepted in
//     another tab), the request fails with 409 instead of acting on stale data,
//   * runs in one database transaction, so the books never see half a match,
//   * writes an audit log row.

import type { DB } from "../db";
import { canSeeAll, type CurrentUser } from "../auth";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { bankFeesLedgerId, clearingLedgerId, dueFromLedgerId, dueToLedgerId } from "../org";
import { legsKeyOf } from "../matcher";
import { DEFAULT_CONFIG } from "../matcher/types";
import { enqueue } from "./jobs";
import { MATCH_JOB } from "./import";
import { importCategoryOf, postEntry, postReversal, type EntryInput } from "./ledger";

export type LegView = {
  transactionId: number;
  direction: "out" | "in";
  accountId: string;
  accountName: string;
  last4: string;
  entityId: string;
  entityName: string;
  postedDate: string;
  amountCents: number;
  memo: string;
  importCategory: string;
};

export type ProposalView = {
  id: number;
  status: string;
  kind: "same_entity" | "intercompany";
  source: "matcher" | "manual";
  tier: "high" | "review";
  confidence: number;
  reasons: string[];
  feeCents: number;
  version: number;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  legs: LegView[];
  totalCents: number;
};

type ProposalRow = {
  id: number;
  status: string;
  kind: "same_entity" | "intercompany";
  source: "matcher" | "manual";
  tier: "high" | "review";
  confidence: number;
  reasons: string;
  legs_key: string;
  fee_cents: number;
  version: number;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function legsOf(db: DB, proposalId: number): LegView[] {
  return db
    .prepare(
      `SELECT l.transaction_id AS transactionId, l.direction, t.account_id AS accountId, ba.name AS accountName,
              ba.last4, ba.entity_id AS entityId, e.name AS entityName, t.posted_date AS postedDate,
              t.amount_cents AS amountCents, t.memo,
              (SELECT la.name FROM journal_entries je
                 JOIN journal_lines jl ON jl.entry_id = je.id
                 JOIN ledger_accounts la ON la.id = jl.ledger_account_id
                WHERE je.bank_transaction_id = t.id AND je.source = 'bank_import' AND la.kind <> 'cash') AS importCategory
         FROM match_legs l
         JOIN bank_transactions t ON t.id = l.transaction_id
         JOIN bank_accounts ba ON ba.id = t.account_id
         JOIN entities e ON e.id = ba.entity_id
        WHERE l.proposal_id = ?
        ORDER BY l.direction DESC, t.posted_date, t.id`,
    )
    .all(proposalId) as LegView[];
}

function toView(db: DB, row: ProposalRow): ProposalView {
  const legs = legsOf(db, row.id);
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    source: row.source,
    tier: row.tier,
    confidence: row.confidence,
    reasons: JSON.parse(row.reasons),
    feeCents: row.fee_cents,
    version: row.version,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    legs,
    totalCents: legs.filter((l) => l.direction === "out").reduce((s, l) => s - l.amountCents, 0),
  };
}

export function getProposal(db: DB, user: CurrentUser, id: number): ProposalView {
  const row = db.prepare("SELECT * FROM match_proposals WHERE id = ?").get(id) as ProposalRow | undefined;
  if (!row) throw notFound(`Proposal ${id}`);
  const view = toView(db, row);
  // Don't even confirm the proposal exists to someone who can't see both sides.
  if (!canSeeAll(user, view.legs.map((l) => l.entityId))) throw notFound(`Proposal ${id}`);
  return view;
}

/** Proposals the user may see: every leg must be on an entity they have access to. */
export function listProposals(db: DB, user: CurrentUser, statuses: string[]): ProposalView[] {
  const placeholders = statuses.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT p.* FROM match_proposals p
        WHERE p.status IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM match_legs l
              JOIN bank_transactions t ON t.id = l.transaction_id
              JOIN bank_accounts ba ON ba.id = t.account_id
             WHERE l.proposal_id = p.id
               AND ba.entity_id NOT IN (SELECT entity_id FROM user_entity_access WHERE user_id = ?))
        ORDER BY CASE p.tier WHEN 'high' THEN 0 ELSE 1 END, p.confidence DESC, p.id`,
    )
    .all(...statuses, user.id) as ProposalRow[];
  return rows.map((r) => toView(db, r));
}

/** How many open proposals exist that this user can't see (so the UI can say so, not hide it silently). */
export function hiddenProposalCount(db: DB, user: CurrentUser): number {
  const visible = listProposals(db, user, ["proposed"]).length;
  const all = (db.prepare("SELECT count(*) AS n FROM match_proposals WHERE status = 'proposed'").get() as { n: number }).n;
  return all - visible;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function loadForWrite(db: DB, user: CurrentUser, id: number, expectedVersion: number, expectedStatus: string) {
  const view = getProposal(db, user, id); // 404s if missing or invisible
  if (view.status !== expectedStatus || view.version !== expectedVersion) {
    throw conflict(`Proposal ${id} changed since you loaded it (now ${view.status}, v${view.version}). Refresh and try again.`, {
      current: view,
    });
  }
  return view;
}

function bumpStatus(db: DB, id: number, fromVersion: number, status: string, userId: string, activeLegs: boolean) {
  // The WHERE on version makes this a compare-and-swap: if anything changed
  // between our read and this write, zero rows update and we abort.
  const res = db
    .prepare(
      `UPDATE match_proposals SET status = ?, version = version + 1, decided_at = ?, decided_by = ?
        WHERE id = ? AND version = ?`,
    )
    .run(status, new Date().toISOString(), userId, id, fromVersion);
  if (res.changes !== 1) throw conflict(`Proposal ${id} was changed concurrently`);
  if (!activeLegs) db.prepare("UPDATE match_legs SET active = 0 WHERE proposal_id = ?").run(id);
}

function audit(db: DB, actor: string, action: string, proposalId: number | null, details: unknown) {
  db.prepare("INSERT INTO audit_log (actor, action, proposal_id, details) VALUES (?, ?, ?, ?)").run(
    actor,
    action,
    proposalId,
    JSON.stringify(details),
  );
}

/**
 * The accounting for a match. For each bank transaction in the match we post
 * a RECLASSIFICATION entry that moves its amount out of whatever income or
 * expense category the import guessed, into a balance-sheet account:
 *
 *   same entity:   both sides go through "Transfers in Transit" (nets to 0)
 *   intercompany:  sender books "Due from <receiver>"  (an asset: it's owed money)
 *                  receiver books "Due to <sender>"    (a liability: it owes money)
 *                  Combined, the two cancel out exactly ("eliminate on consolidation").
 *   fee:           the shortfall becomes Bank Fees on the receiving entity.
 *
 * The original import entries are never edited (append-only ledger).
 */
export function buildTransferEntries(db: DB, view: ProposalView, actor: string): EntryInput[] {
  const outs = view.legs.filter((l) => l.direction === "out");
  const ins = view.legs.filter((l) => l.direction === "in");

  // Who sent how much to whom. 1:1 and 1:many: each deposit is a flow from the
  // single withdrawal; many:1: each withdrawal is a flow into the single deposit.
  type Flow = { from: LegView; to: LegView; cents: number };
  const flows: Flow[] =
    outs.length === 1
      ? ins.map((to) => ({ from: outs[0], to, cents: ins.length === 1 ? -outs[0].amountCents : to.amountCents }))
      : outs.map((from) => ({ from, to: ins[0], cents: -from.amountCents }));

  const counterpartFor = (leg: LegView, other: LegView, side: "sender" | "receiver") =>
    leg.entityId === other.entityId
      ? clearingLedgerId(leg.entityId)
      : side === "sender"
        ? dueFromLedgerId(leg.entityId, other.entityId)
        : dueToLedgerId(leg.entityId, other.entityId);

  const entries: EntryInput[] = [];
  for (const leg of outs) {
    const category = importCategoryOf(db, leg.transactionId);
    const amount = -leg.amountCents;
    entries.push({
      entityId: leg.entityId,
      entryDate: leg.postedDate,
      source: "transfer_match",
      memo: `Reclassify transfer out: ${leg.memo}`,
      createdBy: actor,
      bankTransactionId: leg.transactionId,
      proposalId: view.id,
      lines: [
        { ledgerAccountId: category, credit: amount }, // undo the expense the import booked
        ...flows
          .filter((f) => f.from === leg)
          .map((f) => ({ ledgerAccountId: counterpartFor(leg, f.to, "sender"), debit: f.cents })),
      ],
    });
  }
  for (const leg of ins) {
    const category = importCategoryOf(db, leg.transactionId);
    const incoming = flows.filter((f) => f.to === leg);
    const fee = incoming.reduce((s, f) => s + f.cents, 0) - leg.amountCents;
    entries.push({
      entityId: leg.entityId,
      entryDate: leg.postedDate,
      source: "transfer_match",
      memo: `Reclassify transfer in: ${leg.memo}`,
      createdBy: actor,
      bankTransactionId: leg.transactionId,
      proposalId: view.id,
      lines: [
        { ledgerAccountId: category, debit: leg.amountCents }, // undo the income the import booked
        ...(fee > 0 ? [{ ledgerAccountId: bankFeesLedgerId(leg.entityId), debit: fee }] : []),
        ...incoming.map((f) => ({ ledgerAccountId: counterpartFor(leg, f.from, "receiver"), credit: f.cents })),
      ],
    });
  }
  return entries;
}

function applyInTransaction(db: DB, user: CurrentUser, view: ProposalView, action: string) {
  for (const entry of buildTransferEntries(db, view, user.id)) postEntry(db, entry);
  bumpStatus(db, view.id, view.version, "applied", user.id, true);
  audit(db, user.id, action, view.id, { legsKey: legsKeyOf(view.legs.map((l) => String(l.transactionId))) });
}

export function acceptProposal(db: DB, user: CurrentUser, id: number, version: number): ProposalView {
  return db
    .transaction(() => {
      const view = loadForWrite(db, user, id, version, "proposed");
      applyInTransaction(db, user, view, "accept");
      return getProposal(db, user, id);
    })
    .immediate();
}

export function rejectProposal(db: DB, user: CurrentUser, id: number, version: number, reason: string): ProposalView {
  return db
    .transaction(() => {
      loadForWrite(db, user, id, version, "proposed");
      bumpStatus(db, id, version, "rejected", user.id, false);
      const legsKey = db.prepare("SELECT legs_key FROM match_proposals WHERE id = ?").get(id) as { legs_key: string };
      db.prepare("INSERT OR IGNORE INTO rejected_matches (legs_key, rejected_by, reason) VALUES (?, ?, ?)").run(
        legsKey.legs_key,
        user.id,
        reason || "rejected",
      );
      audit(db, user.id, "reject", id, { reason, legsKey: legsKey.legs_key });
      // Freed transactions might pair differently now: re-run matching soon.
      enqueue(db, MATCH_JOB.type, MATCH_JOB.dedupeKey);
      return getProposal(db, user, id);
    })
    .immediate();
}

/** Undo an applied match: post reversing entries (never delete), and remember not to re-propose it. */
export function undoProposal(db: DB, user: CurrentUser, id: number, version: number): ProposalView {
  return db
    .transaction(() => {
      loadForWrite(db, user, id, version, "applied");
      const entries = db
        .prepare(
          `SELECT je.id FROM journal_entries je
            WHERE je.proposal_id = ? AND je.source = 'transfer_match'
              AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id)`,
        )
        .all(id) as { id: number }[];
      for (const e of entries) postReversal(db, e.id, user.id, `Undo transfer match #${id}`);
      bumpStatus(db, id, version, "reversed", user.id, false);
      const { legs_key } = db.prepare("SELECT legs_key FROM match_proposals WHERE id = ?").get(id) as { legs_key: string };
      db.prepare("INSERT OR IGNORE INTO rejected_matches (legs_key, rejected_by, reason) VALUES (?, ?, 'undone')").run(
        legs_key,
        user.id,
      );
      audit(db, user.id, "undo", id, { reversedEntries: entries.length });
      enqueue(db, MATCH_JOB.type, MATCH_JOB.dedupeKey);
      return getProposal(db, user, id);
    })
    .immediate();
}

/**
 * Accept many at once. Each proposal gets its OWN transaction: one stale or
 * forbidden item shouldn't block the other 20. The response says exactly which
 * succeeded and which didn't.
 */
export function bulkAccept(db: DB, user: CurrentUser, items: { id: number; version: number }[]) {
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const item of items) {
    try {
      acceptProposal(db, user, item.id, item.version);
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/**
 * A human matches transactions the matcher missed (e.g. a paper check between
 * entities). Validated with the same rules the matcher uses, then applied
 * immediately: the human IS the review.
 */
export function manualMatch(db: DB, user: CurrentUser, transactionIds: number[]): ProposalView {
  return db
    .transaction(() => {
      if (new Set(transactionIds).size !== transactionIds.length || transactionIds.length < 2) {
        throw badRequest("Pick at least two different transactions");
      }
      const rows = db
        .prepare(
          `SELECT t.id, t.amount_cents, t.account_id, ba.entity_id FROM bank_transactions t
             JOIN bank_accounts ba ON ba.id = t.account_id
            WHERE t.id IN (${transactionIds.map(() => "?").join(",")})`,
        )
        .all(...transactionIds) as { id: number; amount_cents: number; account_id: string; entity_id: string }[];
      if (rows.length !== transactionIds.length) throw notFound("Transaction");
      if (!canSeeAll(user, rows.map((r) => r.entity_id))) throw forbidden("You can't see all of these accounts");

      const outs = rows.filter((r) => r.amount_cents < 0);
      const ins = rows.filter((r) => r.amount_cents > 0);
      if (outs.length === 0 || ins.length === 0) throw badRequest("A transfer needs at least one withdrawal and one deposit");
      if (outs.length > 1 && ins.length > 1) throw badRequest("Many-to-many matches aren't supported; split them up");
      const outTotal = -outs.reduce((s, r) => s + r.amount_cents, 0);
      const inTotal = ins.reduce((s, r) => s + r.amount_cents, 0);
      const fee = outTotal - inTotal;
      if (fee < 0 || fee > DEFAULT_CONFIG.feeToleranceCents || (fee > 0 && outs.length + ins.length > 2)) {
        throw badRequest(`Withdrawals total ${outTotal / 100} but deposits total ${inTotal / 100}`);
      }
      for (const o of outs) {
        if (ins.some((i) => i.account_id === o.account_id)) throw badRequest("Money can't transfer to its own account");
      }

      // Anything already APPLIED can't be re-matched; open proposals that
      // claim these transactions are superseded by the human's decision.
      const claimed = db
        .prepare(
          `SELECT DISTINCT p.id, p.status FROM match_legs l JOIN match_proposals p ON p.id = l.proposal_id
            WHERE l.active = 1 AND l.transaction_id IN (${transactionIds.map(() => "?").join(",")})`,
        )
        .all(...transactionIds) as { id: number; status: string }[];
      if (claimed.some((c) => c.status === "applied")) throw conflict("One of these is already part of an applied match");
      for (const c of claimed) {
        db.prepare("UPDATE match_proposals SET status = 'superseded', version = version + 1 WHERE id = ?").run(c.id);
        db.prepare("UPDATE match_legs SET active = 0 WHERE proposal_id = ?").run(c.id);
      }

      const kind = new Set(rows.map((r) => r.entity_id)).size > 1 ? "intercompany" : "same_entity";
      const legsKey = legsKeyOf(transactionIds.map(String));
      const id = Number(
        db
          .prepare(
            `INSERT INTO match_proposals (status, kind, source, tier, confidence, reasons, legs_key, fee_cents)
             VALUES ('proposed', ?, 'manual', 'review', 1, ?, ?, ?)`,
          )
          .run(kind, JSON.stringify([`Matched by hand by ${user.name}`]), legsKey, fee).lastInsertRowid,
      );
      const insertLeg = db.prepare("INSERT INTO match_legs (proposal_id, transaction_id, direction, active) VALUES (?, ?, ?, 1)");
      for (const r of rows) insertLeg.run(id, r.id, r.amount_cents < 0 ? "out" : "in");

      applyInTransaction(db, user, getProposal(db, user, id), "manual_match");
      return getProposal(db, user, id);
    })
    .immediate();
}

/** Reject many at once; same per-item transactions and reporting as bulkAccept. */
export function bulkReject(db: DB, user: CurrentUser, items: { id: number; version: number }[], reason: string) {
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const item of items) {
    try {
      rejectProposal(db, user, item.id, item.version, reason);
      results.push({ id: item.id, ok: true });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
