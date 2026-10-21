// Bank feed import. In production this is the handler for the bank-data
// aggregator's webhook ("new transactions available for account X").
//
// Properties that matter:
//   * Idempotent. Aggregators re-send data and webhooks fire more than once,
//     so rows are upserted on (account_id, provider_txn_id). Importing the same
//     batch twice changes nothing.
//   * Atomic. New rows, their journal entries, and the follow-up matching job
//     commit together or not at all.
//   * Fast. The import itself never runs the matcher; it just enqueues a job.
//     Webhook handlers should return quickly or the sender retries.
//
// Not handled here (designed, not built): some aggregators issue a NEW id when
// a pending transaction posts, linking back via a pending_transaction_id. A
// production importer would replace the pending row instead of adding a second.

import type { DB } from "../db";
import { naiveCategorize } from "../categorize";
import { ledgerId } from "../org";
import { enqueue } from "./jobs";
import { postEntry } from "./ledger";

export type FeedRow = {
  providerTxnId: string;
  accountId: string;
  postedDate: string;
  amountCents: number;
  memo: string;
};

export type ImportResult = { received: number; inserted: number; duplicates: number; jobId: number | null };

export const MATCH_JOB = { type: "match_transfers", dedupeKey: "match_transfers:org" };

export function importTransactions(db: DB, rows: FeedRow[], actor: string): ImportResult {
  const insertTxn = db.prepare(
    `INSERT INTO bank_transactions (account_id, provider_txn_id, posted_date, amount_cents, memo)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (account_id, provider_txn_id) DO NOTHING
     RETURNING id`,
  );
  const accountOf = db.prepare("SELECT entity_id, ledger_account_id FROM bank_accounts WHERE id = ?");

  const run = db.transaction((): ImportResult => {
    let inserted = 0;
    for (const row of rows) {
      const created = insertTxn.get(row.accountId, row.providerTxnId, row.postedDate, row.amountCents, row.memo) as
        | { id: number }
        | undefined;
      if (!created) continue; // already imported: idempotent no-op
      inserted++;

      // Book it the naive way, like a basic bank import would.
      const acct = accountOf.get(row.accountId) as { entity_id: string; ledger_account_id: string };
      const category = ledgerId(acct.entity_id, naiveCategorize(row.memo, row.amountCents));
      const amount = Math.abs(row.amountCents);
      const moneyIn = row.amountCents > 0;
      postEntry(db, {
        entityId: acct.entity_id,
        entryDate: row.postedDate,
        source: "bank_import",
        memo: row.memo,
        createdBy: actor,
        bankTransactionId: created.id,
        lines: [
          { ledgerAccountId: acct.ledger_account_id, debit: moneyIn ? amount : 0, credit: moneyIn ? 0 : amount },
          { ledgerAccountId: category, debit: moneyIn ? 0 : amount, credit: moneyIn ? amount : 0 },
        ],
      });
    }
    const job = inserted > 0 ? enqueue(db, MATCH_JOB.type, MATCH_JOB.dedupeKey) : null;
    if (inserted > 0) {
      db.prepare("INSERT INTO audit_log (actor, action, details) VALUES (?, 'bank_sync', ?)").run(
        actor,
        JSON.stringify({ received: rows.length, inserted }),
      );
    }
    return { received: rows.length, inserted, duplicates: rows.length - inserted, jobId: job?.id ?? null };
  });
  // IMMEDIATE takes the write lock up front, so the transaction can't fail
  // halfway with SQLITE_BUSY after it has already read data.
  return run.immediate();
}
