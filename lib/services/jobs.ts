// A job queue backed by a database table.
//
// Why a table and not Redis / Pub/Sub / Cloud Tasks?
//   * Transactional enqueue: the job row is written in the SAME transaction as
//     the bank transactions that caused it. If the import rolls back, so does
//     the job; if it commits, the job is guaranteed to exist. (With an external
//     queue you need the "transactional outbox" pattern to get this.)
//   * One less moving part for a demo.
// The cost: polling, and throughput limited by the database. At production
// scale this becomes Cloud Tasks / Pub/Sub, fed by an outbox table.

import type { DB } from "../db";

export type Job = {
  id: number;
  type: string;
  dedupe_key: string;
  status: "queued" | "running" | "done" | "failed";
  run_after: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  last_error: string | null;
  result: string | null;
};

const iso = (msFromNow = 0) => new Date(Date.now() + msFromNow).toISOString();

/**
 * Enqueue with trailing debounce: if a job with this key is already queued,
 * push its start time back instead of adding a second job. A burst of 10
 * imports therefore produces ONE matching run, a couple of seconds after the
 * last import.
 */
export function enqueue(db: DB, type: string, dedupeKey: string, debounceMs = 2000): Job {
  return db
    .prepare(
      `INSERT INTO jobs (type, dedupe_key, status, run_after)
       VALUES (?, ?, 'queued', ?)
       ON CONFLICT (dedupe_key) WHERE status = 'queued'
       DO UPDATE SET run_after = excluded.run_after, updated_at = excluded.run_after
       RETURNING *`,
    )
    .get(type, dedupeKey, iso(debounceMs)) as Job;
}

/**
 * Atomically claim the next ready job. A single UPDATE ... RETURNING is atomic
 * in SQLite, so two workers can never claim the same job. (Postgres version:
 * SELECT ... FOR UPDATE SKIP LOCKED inside the subquery.)
 */
export function claimNext(db: DB): Job | undefined {
  return db
    .prepare(
      `UPDATE jobs
         SET status = 'running', attempts = attempts + 1, locked_at = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued' AND run_after <= ?
         ORDER BY run_after, id
         LIMIT 1
       )
       RETURNING *`,
    )
    .get(iso(), iso(), iso()) as Job | undefined;
}

export function complete(db: DB, job: Job, result: unknown): void {
  db.prepare("UPDATE jobs SET status = 'done', result = ?, locked_at = NULL, updated_at = ? WHERE id = ?").run(
    JSON.stringify(result),
    iso(),
    job.id,
  );
}

/** Retry with exponential backoff (2s, 4s, 8s...) until max_attempts, then give up. */
export function fail(db: DB, job: Job, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (job.attempts >= job.max_attempts) {
    db.prepare("UPDATE jobs SET status = 'failed', last_error = ?, locked_at = NULL, updated_at = ? WHERE id = ?").run(
      message,
      iso(),
      job.id,
    );
    return;
  }
  requeue(db, job, iso(1000 * 2 ** job.attempts), message);
}

/**
 * Put a running job back in the queue. If a newer job with the same key is
 * already queued (new data arrived meanwhile), that one will redo this work
 * with fresher data, so this one can simply be marked done.
 */
function requeue(db: DB, job: Job, runAfter: string, error: string | null): void {
  try {
    db.prepare(
      "UPDATE jobs SET status = 'queued', run_after = ?, last_error = ?, locked_at = NULL, updated_at = ? WHERE id = ?",
    ).run(runAfter, error, iso(), job.id);
  } catch (e) {
    if (!String(e).includes("UNIQUE")) throw e;
    db.prepare("UPDATE jobs SET status = 'done', result = ?, locked_at = NULL, updated_at = ? WHERE id = ?").run(
      JSON.stringify({ supersededByNewerJob: true }),
      iso(),
      job.id,
    );
  }
}

/** A worker that crashed mid-job leaves it 'running' forever; put those back. */
export function recoverStuckJobs(db: DB, olderThanMs = 60_000): number {
  const stuck = db
    .prepare("SELECT * FROM jobs WHERE status = 'running' AND locked_at < ?")
    .all(iso(-olderThanMs)) as Job[];
  for (const job of stuck) requeue(db, job, iso(), "recovered after worker timeout");
  return stuck.length;
}

export function jobSummary(db: DB) {
  return {
    queued: (db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'queued'").get() as { n: number }).n,
    running: (db.prepare("SELECT count(*) AS n FROM jobs WHERE status = 'running'").get() as { n: number }).n,
    recent: db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT 5").all() as Job[],
  };
}
