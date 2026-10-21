// GET /api/proposals/:id/preflight: the checks that must pass before this match can be applied.

import { intParam, route } from "@/lib/http";
import { getProposal } from "@/lib/services/proposals";
import { preflight } from "@/lib/services/preflight";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(({ db, user, params }) => preflight(db, user, getProposal(db, user, intParam(params.id))));
