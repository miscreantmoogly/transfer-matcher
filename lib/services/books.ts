// What the customer actually cares about: are my books right?
//
// "Reported income before matching" counts only the naive import entries;
// "now" includes the reclassifications from applied matches. The difference
// is money that was never income: just the owner moving cash around.

import type { DB } from "../db";
import type { CurrentUser } from "../auth";
import { DEFAULT_CONFIG } from "../matcher/types";
import { hasTransferWords } from "../matcher/signals";
import { businessDaysBetween } from "../dates";

export type EntityBooks = {
  entityId: string;
  entityName: string;
  incomeBeforeCents: number;
  incomeNowCents: number;
  expenseBeforeCents: number;
  expenseNowCents: number;
  transfersInTransitCents: number;
  dueFrom: { otherEntityName: string; cents: number }[];
  dueTo: { otherEntityName: string; cents: number }[];
};

export type BooksSummary = {
  entities: EntityBooks[];
  /** Sum of every Due-from minus every Due-to across visible entities: must be 0. */
  intercompanyNetCents: number | null;
  unbalancedEntries: number;
};

export function booksSummary(db: DB, user: CurrentUser): BooksSummary {
  const sumFor = (entityId: string, where: string) =>
    (
      db
        .prepare(
          `SELECT coalesce(sum(jl.credit_cents - jl.debit_cents), 0) AS cents
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.entry_id
             JOIN ledger_accounts la ON la.id = jl.ledger_account_id
            WHERE je.entity_id = ? AND ${where}`,
        )
        .get(entityId) as { cents: number }
    ).cents;

  const entities = db
    .prepare(`SELECT id, name FROM entities WHERE id IN (${user.entityIds.map(() => "?").join(",")}) ORDER BY name`)
    .all(...user.entityIds) as { id: string; name: string }[];

  const books: EntityBooks[] = entities.map((e) => {
    const balances = (kind: string) =>
      (
        db
          .prepare(
            `SELECT o.name AS otherEntityName, coalesce(sum(jl.debit_cents - jl.credit_cents), 0) AS cents
               FROM ledger_accounts la
               JOIN entities o ON o.id = la.counterparty_entity_id
               LEFT JOIN journal_lines jl ON jl.ledger_account_id = la.id
              WHERE la.entity_id = ? AND la.kind = ?
              GROUP BY la.id`,
          )
          .all(e.id, kind) as { otherEntityName: string; cents: number }[]
      );
    return {
      entityId: e.id,
      entityName: e.name,
      incomeBeforeCents: sumFor(e.id, "la.type = 'income' AND je.source = 'bank_import'"),
      incomeNowCents: sumFor(e.id, "la.type = 'income'"),
      expenseBeforeCents: 0 - sumFor(e.id, "la.type = 'expense' AND je.source = 'bank_import'"),
      expenseNowCents: 0 - sumFor(e.id, "la.type = 'expense'"),
      transfersInTransitCents: 0 - sumFor(e.id, "la.kind = 'transfer_clearing'"),
      dueFrom: balances("due_from"),
      // Liabilities have credit balances; flip the sign so "owes $X" reads positive.
      dueTo: balances("due_to").map((d) => ({ ...d, cents: 0 - d.cents })),
    };
  });

  const seesEverything =
    (db.prepare("SELECT count(*) AS n FROM entities").get() as { n: number }).n === user.entityIds.length;
  const intercompanyNetCents = seesEverything
    ? books.reduce(
        (s, b) => s + b.dueFrom.reduce((x, d) => x + d.cents, 0) - b.dueTo.reduce((x, d) => x + d.cents, 0),
        0,
      )
    : null;

  return {
    entities: books,
    intercompanyNetCents,
    unbalancedEntries: (db.prepare("SELECT count(*) AS n FROM unbalanced_entries").get() as { n: number }).n,
  };
}

export type UnmatchedTxn = {
  id: number;
  accountId: string;
  accountName: string;
  last4: string;
  entityId: string;
  entityName: string;
  postedDate: string;
  amountCents: number;
  memo: string;
  category: string;
  /** Looks like one side of a transfer, and is recent enough that the other side may still arrive. */
  awaitingCounterpart: boolean;
};

/** Transactions not in any live match, on entities the user can see. */
export function unmatchedTransactions(db: DB, user: CurrentUser): UnmatchedTxn[] {
  const latest = (db.prepare("SELECT max(posted_date) AS d FROM bank_transactions").get() as { d: string | null }).d;
  const rows = db
    .prepare(
      `SELECT t.id, t.account_id AS accountId, ba.name AS accountName, ba.last4, ba.entity_id AS entityId,
              e.name AS entityName, t.posted_date AS postedDate, t.amount_cents AS amountCents, t.memo,
              (SELECT la.name FROM journal_entries je
                 JOIN journal_lines jl ON jl.entry_id = je.id
                 JOIN ledger_accounts la ON la.id = jl.ledger_account_id
                WHERE je.bank_transaction_id = t.id AND je.source = 'bank_import' AND la.kind <> 'cash') AS category
         FROM bank_transactions t
         JOIN bank_accounts ba ON ba.id = t.account_id
         JOIN entities e ON e.id = ba.entity_id
        WHERE ba.entity_id IN (SELECT entity_id FROM user_entity_access WHERE user_id = ?)
          AND NOT EXISTS (SELECT 1 FROM match_legs l WHERE l.transaction_id = t.id AND l.active = 1)
        ORDER BY t.posted_date DESC, t.id DESC`,
    )
    .all(user.id) as Omit<UnmatchedTxn, "awaitingCounterpart">[];
  return rows.map((r) => ({
    ...r,
    awaitingCounterpart:
      !!latest &&
      r.amountCents < 0 &&
      hasTransferWords(r.memo) &&
      businessDaysBetween(r.postedDate, latest) <= DEFAULT_CONFIG.windowBusinessDays,
  }));
}

export function recentAudit(db: DB, limit = 15) {
  return db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number;
    at: string;
    actor: string;
    action: string;
    proposal_id: number | null;
    details: string | null;
  }[];
}

export function counts(db: DB) {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    bankTransactions: one("SELECT count(*) AS n FROM bank_transactions"),
    proposed: one("SELECT count(*) AS n FROM match_proposals WHERE status = 'proposed'"),
    applied: one("SELECT count(*) AS n FROM match_proposals WHERE status = 'applied'"),
    latestPostedDate: (db.prepare("SELECT max(posted_date) AS d FROM bank_transactions").get() as { d: string | null }).d,
  };
}
