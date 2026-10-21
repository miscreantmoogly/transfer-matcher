// POST /api/reset: wipe the demo back to "no bank data yet". Demo-only endpoint.

import { route } from "@/lib/http";
import { resetData } from "@/lib/db";

export const POST = route(({ db }) => {
  resetData(db);
  return { ok: true };
});
