// POST /api/proposals/:id/reject { version, reason }: "these aren't a transfer". Never proposed again.

import { intParam, route } from "@/lib/http";
import { rejectProposal } from "@/lib/services/proposals";

export const POST = route<{ id: string }>(({ db, user, body, params }) =>
  rejectProposal(db, user, intParam(params.id), Number(body.version), String(body.reason ?? "")),
);
