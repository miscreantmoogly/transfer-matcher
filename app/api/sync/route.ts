// POST /api/sync { batch: 1 | 2 }: simulates the bank-data aggregator's webhook.
// Imports rows and enqueues a matching job; it does NOT run the matcher inline.

import { route } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { syncBatch } from "@/lib/services/demo";

export const POST = route(({ db, user, body }) => {
  const batch = Number(body.batch);
  if (![1, 2].includes(batch)) throw badRequest("batch must be 1 or 2");
  return syncBatch(db, batch, user.id);
});
