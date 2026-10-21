// Demo plumbing: stands in for the bank-data aggregator. "Bank sync N" reads
// batch N of data/bank_feed.json and pushes it through the real import path.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "../db";
import { importTransactions, type ImportResult } from "./import";

type FeedFile = { transactions: { providerTxnId: string; accountId: string; postedDate: string; amountCents: number; memo: string; batch: number }[] };

export function loadFeed(): FeedFile {
  return JSON.parse(readFileSync(join(process.cwd(), "data", "bank_feed.json"), "utf8"));
}

export function syncBatch(db: DB, batch: number, actor: string): ImportResult {
  const rows = loadFeed().transactions.filter((t) => t.batch === batch);
  return importTransactions(db, rows, actor);
}
