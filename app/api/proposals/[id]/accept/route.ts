// POST /api/proposals/:id/accept { version }: apply the match to the books.

import { intParam, route } from "@/lib/http";
import { acceptProposal } from "@/lib/services/proposals";

export const POST = route<{ id: string }>(({ db, user, body, params }) =>
  acceptProposal(db, user, intParam(params.id), Number(body.version)),
);
