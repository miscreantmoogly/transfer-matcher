// POST /api/proposals/:id/undo { version }: reverse an applied match with reversing entries.

import { intParam, route } from "@/lib/http";
import { undoProposal } from "@/lib/services/proposals";

export const POST = route<{ id: string }>(({ db, user, body, params }) =>
  undoProposal(db, user, intParam(params.id), Number(body.version)),
);
