// POST /api/consolidation/sales
//   { buyerTxnId, sellerTxnId, decision }            one pair
//   { items: [{ buyerTxnId, sellerTxnId }], decision } several, each in its own transaction
// decision: "confirmed" | "dismissed" | "undecided" (clears an earlier decision).

import { intParam, route } from "@/lib/http";
import { HttpError } from "@/lib/errors";
import { decideSale } from "@/lib/services/consolidation";

type Pair = { buyerTxnId: unknown; sellerTxnId: unknown };

export const POST = route(({ db, user, body }) => {
  const one = (p: Pair) => decideSale(db, user, intParam(String(p.buyerTxnId)), intParam(String(p.sellerTxnId)), body.decision);
  if (!Array.isArray(body.items)) {
    one(body);
    return { ok: true };
  }
  // Like bulk accept: one failure doesn't undo the others, and each result is reported.
  return body.items.map((p: Pair) => {
    try {
      one(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof HttpError ? e.message : String(e) };
    }
  });
});
