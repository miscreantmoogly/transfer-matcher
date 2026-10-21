// The only code path that writes to the ledger. Every entry is validated
// (balanced, one-sided lines, accounts on the right entity) before insert,
// so an unbalanced entry is impossible rather than merely unlikely.

import type { DB } from "../db";

export type LineInput = { ledgerAccountId: string; debit?: number; credit?: number };
export type EntryInput = {
  entityId: string;
  entryDate: string;
  source: "bank_import" | "transfer_match" | "transfer_reversal";
  memo: string;
  createdBy: string;
  bankTransactionId?: number | null;
  proposalId?: number | null;
  reversesEntryId?: number | null;
  lines: LineInput[];
};

export function postEntry(db: DB, entry: EntryInput): number {
  const lines = entry.lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  if (lines.length < 2) throw new Error(`Journal entry needs at least two lines: ${entry.memo}`);
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c)) throw new Error("Amounts must be integer cents");
    if (d > 0 && c > 0) throw new Error("A line is a debit or a credit, not both");
    debits += d;
    credits += c;
  }
  if (debits !== credits) {
    throw new Error(`Unbalanced entry "${entry.memo}": debits ${debits} != credits ${credits}`);
  }

  const accountEntity = db.prepare("SELECT entity_id FROM ledger_accounts WHERE id = ?");
  for (const l of lines) {
    const row = accountEntity.get(l.ledgerAccountId) as { entity_id: string } | undefined;
    if (!row) throw new Error(`Unknown ledger account ${l.ledgerAccountId}`);
    if (row.entity_id !== entry.entityId) {
      throw new Error(`Ledger account ${l.ledgerAccountId} is not on ${entry.entityId}'s books`);
    }
  }

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO journal_entries
         (entity_id, entry_date, source, bank_transaction_id, proposal_id, reverses_entry_id, memo, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.entityId,
      entry.entryDate,
      entry.source,
      entry.bankTransactionId ?? null,
      entry.proposalId ?? null,
      entry.reversesEntryId ?? null,
      entry.memo,
      entry.createdBy,
    );
  const entryId = Number(lastInsertRowid);
  const insertLine = db.prepare(
    "INSERT INTO journal_lines (entry_id, ledger_account_id, debit_cents, credit_cents) VALUES (?, ?, ?, ?)",
  );
  for (const l of lines) insertLine.run(entryId, l.ledgerAccountId, l.debit ?? 0, l.credit ?? 0);
  return entryId;
}

/** The category a bank transaction was booked to at import (the non-cash side). */
export function importCategoryOf(db: DB, bankTransactionId: number): string {
  const row = db
    .prepare(
      `SELECT jl.ledger_account_id AS id
         FROM journal_entries je
         JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN ledger_accounts la ON la.id = jl.ledger_account_id
        WHERE je.bank_transaction_id = ? AND je.source = 'bank_import' AND la.kind <> 'cash'`,
    )
    .get(bankTransactionId) as { id: string } | undefined;
  if (!row) throw new Error(`No import entry for bank transaction ${bankTransactionId}`);
  return row.id;
}

/** Post the mirror image of an entry (debits <-> credits). The original stays untouched. */
export function postReversal(db: DB, entryId: number, createdBy: string, memo: string): number {
  const original = db.prepare("SELECT * FROM journal_entries WHERE id = ?").get(entryId) as {
    entity_id: string;
    entry_date: string;
    proposal_id: number | null;
    bank_transaction_id: number | null;
  };
  const lines = db.prepare("SELECT * FROM journal_lines WHERE entry_id = ?").all(entryId) as {
    ledger_account_id: string;
    debit_cents: number;
    credit_cents: number;
  }[];
  return postEntry(db, {
    entityId: original.entity_id,
    entryDate: original.entry_date,
    source: "transfer_reversal",
    memo,
    createdBy,
    bankTransactionId: original.bank_transaction_id,
    proposalId: original.proposal_id,
    reversesEntryId: entryId,
    lines: lines.map((l) => ({ ledgerAccountId: l.ledger_account_id, debit: l.credit_cents, credit: l.debit_cents })),
  });
}
