// Database access. SQLite via better-sqlite3: a single file, no server.
//
// Two processes use this file at once: the Next.js web server and the
// background worker. WAL mode lets readers proceed while one writer writes,
// and busy_timeout makes a second writer wait (up to 5s) instead of failing.
//
// In production this would be Postgres (Cloud SQL). What would change:
//   * row-level locks instead of SQLite's single database-wide write lock,
//   * workers claiming jobs with SELECT ... FOR UPDATE SKIP LOCKED,
//   * a connection pool instead of one connection per process.

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  BANK_ACCOUNTS,
  CATEGORIES,
  ENTITIES,
  USERS,
  bankFeesLedgerId,
  cashLedgerId,
  clearingLedgerId,
  dueFromLedgerId,
  dueToLedgerId,
  ledgerId,
  ownerContributionsLedgerId,
  ownerDrawsLedgerId,
  ownerTransfersLedgerId,
} from "./org";

export type DB = Database.Database;

const ROOT = process.cwd();
export const DEFAULT_DB_PATH = process.env.DB_PATH ?? join(ROOT, "data", "app.db");

export function openDb(path: string = DEFAULT_DB_PATH): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** One connection per server process, kept across Next.js hot reloads in dev. */
export function getDb(): DB {
  const g = globalThis as unknown as { __transferMatcherDb?: DB };
  if (!g.__transferMatcherDb) {
    if (!existsSync(DEFAULT_DB_PATH)) {
      throw new Error(`No database at ${DEFAULT_DB_PATH}. Run "npm run seed" first.`);
    }
    g.__transferMatcherDb = openDb();
  }
  return g.__transferMatcherDb;
}

/** Create the schema and the demo organization's reference data (no bank data yet). */
export function initSchema(db: DB): void {
  db.exec(readFileSync(join(ROOT, "db", "schema.sql"), "utf8"));
  insertReferenceData(db);
}

/** Delete the database file and start fresh. Used by `npm run seed` and tests. */
export function createFreshDb(path: string = DEFAULT_DB_PATH): DB {
  if (path !== ":memory:") {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  }
  const db = openDb(path);
  initSchema(db);
  return db;
}

function insertReferenceData(db: DB): void {
  const insertEntity = db.prepare("INSERT INTO entities (id, name, kind) VALUES (?, ?, ?)");
  const insertUser = db.prepare("INSERT INTO users (id, name, role) VALUES (?, ?, ?)");
  const insertAccess = db.prepare("INSERT INTO user_entity_access (user_id, entity_id) VALUES (?, ?)");
  const insertLedger = db.prepare(
    "INSERT INTO ledger_accounts (id, entity_id, name, type, kind, counterparty_entity_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertBank = db.prepare(
    "INSERT INTO bank_accounts (id, entity_id, name, last4, ledger_account_id) VALUES (?, ?, ?, ?, ?)",
  );

  db.transaction(() => {
    for (const e of ENTITIES) insertEntity.run(e.id, e.name, e.kind);
    for (const u of USERS) {
      insertUser.run(u.id, u.name, u.role);
      for (const entityId of u.entityIds) insertAccess.run(u.id, entityId);
    }
    const businesses = ENTITIES.filter((e) => e.kind === "business");
    for (const e of ENTITIES) {
      // Income and expense categories
      for (const c of CATEGORIES) insertLedger.run(ledgerId(e.id, c.slug), e.id, c.name, c.type, "category", null);
      // Special accounts the matcher posts to
      insertLedger.run(clearingLedgerId(e.id), e.id, "Transfers in Transit", "asset", "transfer_clearing", null);
      insertLedger.run(bankFeesLedgerId(e.id), e.id, "Bank Fees", "expense", "bank_fees", null);
      if (e.kind === "personal") {
        insertLedger.run(ownerTransfersLedgerId(e.id), e.id, "Transfers with your businesses", "equity", "owner_transfers", null);
        continue;
      }
      insertLedger.run(ownerDrawsLedgerId(e.id), e.id, "Owner's Draws", "equity", "owner_draws", null);
      insertLedger.run(ownerContributionsLedgerId(e.id), e.id, "Owner Contributions", "equity", "owner_contributions", null);
      // Intercompany receivable / payable, one pair per sibling business
      for (const other of businesses.filter((o) => o.id !== e.id)) {
        insertLedger.run(dueFromLedgerId(e.id, other.id), e.id, `Due from ${other.name}`, "asset", "due_from", other.id);
        insertLedger.run(dueToLedgerId(e.id, other.id), e.id, `Due to ${other.name}`, "liability", "due_to", other.id);
      }
    }
    // Each bank account is backed by a cash account on its entity's ledger.
    for (const a of BANK_ACCOUNTS) {
      insertLedger.run(cashLedgerId(a.id), a.entityId, `Cash - ${a.name} (...${a.last4})`, "asset", "cash", null);
      insertBank.run(a.id, a.entityId, a.name, a.last4, cashLedgerId(a.id));
    }
  })();
}

export const nowIso = () => new Date().toISOString();

/** Wipe all transactional data but keep the organization's setup. Used by the demo's Reset button. */
export function resetData(db: DB): void {
  db.transaction(() => {
    for (const table of [
      "audit_log",
      "jobs",
      "rejected_matches",
      "match_legs",
      "journal_lines",
      "journal_entries",
      "match_proposals",
      "bank_transactions",
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  }).immediate();
}
