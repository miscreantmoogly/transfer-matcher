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
  /** Money the owner took out of the business (equity, not an expense). */
  ownerDrawsCents: number;
  /** Money the owner put in (equity, not income). */
  ownerContributionsCents: number;
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
    // Business books only: the owner's personal account is connected so draws
    // can be recognized, but its activity is never part of a business's books.
    .prepare(
      `SELECT id, name FROM entities
        WHERE kind = 'business' AND id IN (${user.entityIds.map(() => "?").join(",")}) ORDER BY name`,
    )
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
      ownerDrawsCents: 0 - sumFor(e.id, "la.kind = 'owner_draws'"),
      ownerContributionsCents: sumFor(e.id, "la.kind = 'owner_contributions'"),
      dueFrom: balances("due_from"),
      // Liabilities have credit balances; flip the sign so "owes $X" reads positive.
      dueTo: balances("due_to").map((d) => ({ ...d, cents: 0 - d.cents })),
    };
  });

  const seesEverything =
    (db.prepare("SELECT count(*) AS n FROM entities WHERE kind = 'business'").get() as { n: number }).n === entities.length;
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
  entityKind: "business" | "personal";
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
              e.name AS entityName, e.kind AS entityKind, t.posted_date AS postedDate, t.amount_cents AS amountCents, t.memo,
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

/**
 * Recent activity the user is allowed to see: events with no proposal (bank
 * syncs, matcher runs) plus decisions on matches whose every leg is on an
 * entity they can access. Otherwise the log would leak the other entity's data.
 */
export function recentAudit(db: DB, user: CurrentUser, limit = 15) {
  return db
    .prepare(
      `SELECT a.* FROM audit_log a
        WHERE a.proposal_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM match_legs l
               JOIN bank_transactions t ON t.id = l.transaction_id
               JOIN bank_accounts ba ON ba.id = t.account_id
              WHERE l.proposal_id = a.proposal_id
                AND ba.entity_id NOT IN (SELECT entity_id FROM user_entity_access WHERE user_id = ?))
        ORDER BY a.id DESC LIMIT ?`,
    )
    .all(user.id, limit) as {
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
