// GET /api/consolidation?entities=cedar,hollis: consolidated statements for the
// chosen businesses (default: every business the user can see).

import { route } from "@/lib/http";
import { consolidate } from "@/lib/services/consolidation";

export const GET = route(({ db, user, request }) => {
  const param = new URL(request.url).searchParams.get("entities");
  return consolidate(db, user, param ? param.split(",").filter(Boolean) : undefined);
});
