// POST /api/proposals/bulk-accept { items: [{ id, version }] }: per-item results.

import { route } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { bulkAccept } from "@/lib/services/proposals";

export const POST = route(({ db, user, body }) => {
  if (!Array.isArray(body.items)) throw badRequest("items must be an array");
  return bulkAccept(
    db,
    user,
    body.items.map((i: { id: unknown; version: unknown }) => ({ id: Number(i.id), version: Number(i.version) })),
  );
});
