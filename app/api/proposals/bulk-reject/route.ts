// POST /api/proposals/bulk-reject { items: [{ id, version }], reason }: per-item results.

import { route } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { bulkReject } from "@/lib/services/proposals";

export const POST = route(({ db, user, body }) => {
  if (!Array.isArray(body.items)) throw badRequest("items must be an array");
  return bulkReject(
    db,
    user,
    body.items.map((i: { id: unknown; version: unknown }) => ({ id: Number(i.id), version: Number(i.version) })),
    String(body.reason ?? "Not a transfer"),
  );
});
