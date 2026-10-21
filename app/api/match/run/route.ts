// POST /api/match/run: run matching inline. A fallback for the demo when the
// worker process isn't running; in production only the worker runs matching.

import { route } from "@/lib/http";
import { runMatching } from "@/lib/services/matchRun";

export const POST = route(({ db, user }) => {
  const summary = runMatching(db, user.id);
  db.prepare("UPDATE jobs SET status = 'done', result = '\"ran inline\"' WHERE status = 'queued'").run();
  return summary;
});
