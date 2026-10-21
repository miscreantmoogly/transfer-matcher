// Reset the demo database.
//
//   npm run seed              fresh database, reference data only (start the demo from "Bank sync 1")
//   npm run seed -- --synced  also import sync 1 and run the matcher (skip straight to the review queue)

import { createFreshDb, DEFAULT_DB_PATH } from "../lib/db";
import { syncBatch } from "../lib/services/demo";
import { runMatching } from "../lib/services/matchRun";

const db = createFreshDb();
console.log(`Created ${DEFAULT_DB_PATH}`);

if (process.argv.includes("--synced")) {
  const imported = syncBatch(db, 1, "seed");
  const matched = runMatching(db, "seed");
  // The import enqueued a job; we just did its work inline, so mark it done.
  db.prepare("UPDATE jobs SET status = 'done', result = '\"ran inline by seed\"' WHERE status = 'queued'").run();
  console.log(`Imported ${imported.inserted} transactions; ${matched.created} proposals created.`);
}
db.close();
