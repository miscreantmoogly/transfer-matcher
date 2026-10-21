// GET /api/state: everything the review screen needs, in one round trip.
// (With GraphQL, as Ambrook uses, this would be one query selecting exactly these fields.)

import { route } from "@/lib/http";
import { listProposals, hiddenProposalCount } from "@/lib/services/proposals";
import { booksSummary, counts, recentAudit, unmatchedTransactions } from "@/lib/services/books";
import { jobSummary } from "@/lib/services/jobs";

export const dynamic = "force-dynamic";

export const GET = route(({ db, user }) => ({
  user,
  users: db.prepare("SELECT id, name, role FROM users ORDER BY id DESC").all(),
  proposals: listProposals(db, user, ["proposed"]),
  decided: listProposals(db, user, ["applied", "rejected", "reversed"]).sort((a, b) =>
    (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""),
  ),
  hiddenProposals: hiddenProposalCount(db, user),
  unmatched: unmatchedTransactions(db, user),
  books: booksSummary(db, user),
  counts: counts(db),
  jobs: jobSummary(db),
  audit: recentAudit(db),
}));
