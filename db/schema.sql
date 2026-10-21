-- Transfer Matcher schema (SQLite).
--
-- One database = one customer organization (e.g. a family ranch operation with
-- several legal entities). In a multi-tenant production system every table
-- would also carry an org_id; it's omitted here to keep the demo readable.
--
-- Conventions:
--   * Money is INTEGER cents. Never floats: 0.1 + 0.2 != 0.3.
--   * Bank amounts are signed: negative = money left the account.
--   * Dates are 'YYYY-MM-DD' text; timestamps are ISO-8601 text (UTC).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Who owns what
-- ---------------------------------------------------------------------------

CREATE TABLE entities (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE users (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL
);

-- Which entities' books a user may see. A cross-entity transfer proposal is
-- only visible to (and actionable by) users who can see BOTH sides.
CREATE TABLE user_entity_access (
  user_id   TEXT NOT NULL REFERENCES users(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  PRIMARY KEY (user_id, entity_id)
);

-- ---------------------------------------------------------------------------
-- Chart of accounts (the ledger) and the bank accounts that feed it
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_accounts (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  -- What role the account plays, so code never has to match on names.
  kind        TEXT NOT NULL CHECK (kind IN ('cash', 'category', 'transfer_clearing', 'due_from', 'due_to', 'bank_fees')),
  -- For due_from / due_to: which sibling entity owes / is owed.
  counterparty_entity_id TEXT REFERENCES entities(id)
);

CREATE TABLE bank_accounts (
  id                TEXT PRIMARY KEY,
  entity_id         TEXT NOT NULL REFERENCES entities(id),
  name              TEXT NOT NULL,
  last4             TEXT NOT NULL,
  ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id)
);

-- ---------------------------------------------------------------------------
-- Raw bank feed
-- ---------------------------------------------------------------------------

CREATE TABLE bank_transactions (
  id              INTEGER PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES bank_accounts(id),
  -- The bank/aggregator's ID. Feeds re-send data, so imports upsert on this.
  provider_txn_id TEXT NOT NULL,
  posted_date     TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents <> 0),
  memo            TEXT NOT NULL,
  imported_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (account_id, provider_txn_id)
);

CREATE INDEX bank_transactions_by_date ON bank_transactions (posted_date);
CREATE INDEX bank_transactions_by_amount ON bank_transactions (abs(amount_cents));

-- ---------------------------------------------------------------------------
-- Double-entry ledger. Append-only: entries are never updated or deleted.
-- Fixing a mistake means posting a new entry (a reclassification or reversal).
-- ---------------------------------------------------------------------------

CREATE TABLE journal_entries (
  id                  INTEGER PRIMARY KEY,
  entity_id           TEXT NOT NULL REFERENCES entities(id),
  entry_date          TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('bank_import', 'transfer_match', 'transfer_reversal')),
  bank_transaction_id INTEGER REFERENCES bank_transactions(id),
  proposal_id         INTEGER REFERENCES match_proposals(id),
  reverses_entry_id   INTEGER REFERENCES journal_entries(id),
  memo                TEXT NOT NULL,
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One import entry per bank transaction, no matter how many times it's imported.
CREATE UNIQUE INDEX one_import_entry_per_bank_txn
  ON journal_entries (bank_transaction_id) WHERE source = 'bank_import';

CREATE TABLE journal_lines (
  id                INTEGER PRIMARY KEY,
  entry_id          INTEGER NOT NULL REFERENCES journal_entries(id),
  ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
  debit_cents       INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents      INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  -- Each line is a debit or a credit, never both, never neither.
  CHECK ((debit_cents > 0) <> (credit_cents > 0))
);

CREATE INDEX journal_lines_by_entry ON journal_lines (entry_id);
CREATE INDEX journal_lines_by_account ON journal_lines (ledger_account_id);

-- Audit view: should always be empty. Every entry's debits must equal credits.
-- (App code checks this before commit; the view is the belt to that suspenders.)
CREATE VIEW unbalanced_entries AS
  SELECT entry_id, SUM(debit_cents) AS debits, SUM(credit_cents) AS credits
  FROM journal_lines
  GROUP BY entry_id
  HAVING SUM(debit_cents) <> SUM(credit_cents);

-- ---------------------------------------------------------------------------
-- Match proposals: the "plan" a human reviews before anything touches the books
-- ---------------------------------------------------------------------------

CREATE TABLE match_proposals (
  id          INTEGER PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('proposed', 'applied', 'rejected', 'superseded', 'reversed')),
  kind        TEXT NOT NULL CHECK (kind IN ('same_entity', 'intercompany')),
  source      TEXT NOT NULL CHECK (source IN ('matcher', 'manual')),
  tier        TEXT NOT NULL CHECK (tier IN ('high', 'review')),
  confidence  REAL NOT NULL,
  reasons     TEXT NOT NULL,          -- JSON array of human-readable strings
  legs_key    TEXT NOT NULL,          -- sorted transaction ids, e.g. "12,48" (identity of the match)
  fee_cents   INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  version     INTEGER NOT NULL DEFAULT 1, -- optimistic locking: bumps on every state change
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at  TEXT,
  decided_by  TEXT REFERENCES users(id)
);

CREATE INDEX match_proposals_by_status ON match_proposals (status);

CREATE TABLE match_legs (
  proposal_id    INTEGER NOT NULL REFERENCES match_proposals(id),
  transaction_id INTEGER NOT NULL REFERENCES bank_transactions(id),
  direction      TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  -- 1 while the proposal is 'proposed' or 'applied'; 0 once it's dead.
  active         INTEGER NOT NULL CHECK (active IN (0, 1)),
  PRIMARY KEY (proposal_id, transaction_id)
);

-- THE core invariant: a bank transaction can belong to at most one live match.
-- Enforced by the database, so a race between the background matcher and a
-- user's manual match can't double-book money; the loser's write just fails.
CREATE UNIQUE INDEX one_live_match_per_transaction
  ON match_legs (transaction_id) WHERE active = 1;

-- Matches a human said "no" to. The matcher never proposes these again.
CREATE TABLE rejected_matches (
  legs_key    TEXT PRIMARY KEY,
  rejected_by TEXT REFERENCES users(id),
  rejected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reason      TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Background jobs. A table-backed queue: enqueueing happens in the SAME
-- database transaction as the import, so a job can't be lost and can't
-- reference rows that were rolled back.
-- ---------------------------------------------------------------------------

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_after    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at    TEXT,
  last_error   TEXT,
  result       TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Debounce: at most one queued job per key. A burst of imports collapses into
-- a single matching run instead of N runs.
CREATE UNIQUE INDEX one_queued_job_per_key ON jobs (dedupe_key) WHERE status = 'queued';
CREATE INDEX jobs_ready ON jobs (status, run_after);

-- ---------------------------------------------------------------------------
-- Audit trail of every human or system decision
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor       TEXT NOT NULL,          -- user id, or 'system:worker'
  action      TEXT NOT NULL,
  proposal_id INTEGER REFERENCES match_proposals(id),
  details     TEXT                    -- JSON
);
