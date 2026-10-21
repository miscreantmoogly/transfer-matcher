// POST /api/matches/manual { transactionIds }: a human matches what the matcher missed.

import { route } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { manualMatch } from "@/lib/services/proposals";

export const POST = route(({ db, user, body }) => {
  if (!Array.isArray(body.transactionIds)) throw badRequest("transactionIds must be an array");
  return manualMatch(db, user, body.transactionIds.map(Number));
});
