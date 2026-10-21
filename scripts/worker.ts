// The background worker: a separate process that polls the jobs table.
//
//   npm run worker
//
// Runs alongside the web server and shares the same SQLite file. Production
// equivalent: a Cloud Run job or service triggered by Cloud Tasks / Pub/Sub.

import { openDb } from "../lib/db";
import { claimNext, complete, fail, recoverStuckJobs } from "../lib/services/jobs";
import { MATCH_JOB } from "../lib/services/import";
import { runMatching } from "../lib/services/matchRun";

const POLL_MS = 1000;
const db = openDb();
let stopping = false;

const handlers: Record<string, () => unknown> = {
  [MATCH_JOB.type]: () => runMatching(db),
};

function tick() {
  const recovered = recoverStuckJobs(db);
  if (recovered) console.log(`Recovered ${recovered} stuck job(s)`);

  let job;
  while (!stopping && (job = claimNext(db))) {
    const started = Date.now();
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      const result = handler();
      complete(db, job, result);
      console.log(`job #${job.id} ${job.type} done in ${Date.now() - started}ms`, result);
    } catch (e) {
      fail(db, job, e);
      console.error(`job #${job.id} ${job.type} failed (attempt ${job.attempts}):`, e);
    }
  }
}

const timer = setInterval(tick, POLL_MS);
console.log(`Worker polling every ${POLL_MS}ms. Ctrl-C to stop.`);

// Finish the current job, then exit cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    clearInterval(timer);
    db.close();
    process.exit(0);
  });
}
