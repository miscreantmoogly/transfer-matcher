// Pre-flight checks: the last gate between an approved plan and the books.
//
// Borrowed from AmDo (Ambrook's executor for PlanBrook plans): the planner can
// be wrong, the reviewer can miss things, and data can change between proposal
// and approval. So right before executing, deterministic code re-verifies
// everything that must be true, and refuses to run if anything isn't. The same
// checks are shown to the reviewer in the drawer, so "Accept" is never a leap
// of faith.

import type { DB } from "../db";
import { canSeeAll, type CurrentUser } from "../auth";
import { DEFAULT_CONFIG } from "../matcher/types";
import { buildTransferEntries, type ProposalView } from "./proposals";

export type Check = { id: string; label: string; ok: boolean; detail?: string };

export function preflight(db: DB, user: CurrentUser, view: ProposalView): Check[] {
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string) => checks.push({ id, label, ok, detail });

  // 1. Permission: the executor can only do what this person could do by hand.
  add("access", "You can see every account involved", canSeeAll(user, view.legs.map((l) => l.entityId)));

  // 2. Still open: nobody accepted, rejected or replaced it in the meantime.
  const current = db.prepare("SELECT status, version FROM match_proposals WHERE id = ?").get(view.id) as
    | { status: string; version: number }
    | undefined;
  add(
    "fresh",
    "Nothing changed since this was proposed",
    !!current && current.status === "proposed" && current.version === view.version,
    current ? `now ${current.status}, v${current.version}` : "missing",
  );

  // 3. No double booking: none of these transactions is already in an applied match.
  const ids = view.legs.map((l) => l.transactionId);
  const taken = db
    .prepare(
      `SELECT count(*) AS n FROM match_legs l JOIN match_proposals p ON p.id = l.proposal_id
        WHERE l.active = 1 AND p.status = 'applied' AND p.id <> ? AND l.transaction_id IN (${ids.map(() => "?").join(",")})`,
    )
    .get(view.id, ...ids) as { n: number };
  add("unclaimed", "None of these lines is already in another accepted match", taken.n === 0);

  //    ...or confirmed as a sale between two businesses (real income and expense, not a transfer).
  const sold = db
    .prepare(
      `SELECT count(*) AS n FROM intercompany_sales WHERE status = 'confirmed'
          AND (buyer_txn_id IN (${ids.map(() => "?").join(",")}) OR seller_txn_id IN (${ids.map(() => "?").join(",")}))`,
    )
    .get(...ids, ...ids) as { n: number };
  add("not_a_sale", "None of these lines was confirmed as a sale between your businesses", sold.n === 0);

  // 4. Amounts: money out equals money in, or is short by at most a plausible fee (never on a split).
  const out = -view.legs.filter((l) => l.direction === "out").reduce((s, l) => s + l.amountCents, 0);
  const inn = view.legs.filter((l) => l.direction === "in").reduce((s, l) => s + l.amountCents, 0);
  const fee = out - inn;
  const split = view.legs.length > 2;
  add(
    "amounts",
    fee === 0 ? "Money out equals money in" : `Money in is short by a fee within the $${DEFAULT_CONFIG.feeToleranceCents / 100} limit`,
    fee >= 0 && fee <= DEFAULT_CONFIG.feeToleranceCents && !(split && fee > 0),
  );

  // 5. Different accounts on each side.
  const outAccounts = new Set(view.legs.filter((l) => l.direction === "out").map((l) => l.accountId));
  add("accounts", "No money moves into the account it came from", !view.legs.some((l) => l.direction === "in" && outAccounts.has(l.accountId)));

  // 6. Books open: no line falls in a closed period.
  const closed = db
    .prepare(`SELECT id, name, books_closed_through AS d FROM entities WHERE books_closed_through IS NOT NULL`)
    .all() as { id: string; name: string; d: string }[];
  const blocked = view.legs.find((l) => closed.some((c) => c.id === l.entityId && l.postedDate <= c.d));
  add("period", "Every date is in an open period", !blocked, blocked ? `${blocked.entityName} is closed through ${closed.find((c) => c.id === blocked.entityId)!.d}` : undefined);

  // 7. Dry run: build the journal entries and confirm each one balances and
  //    only touches accounts on its own entity's books.
  let balanced = true;
  let detail: string | undefined;
  try {
    const entityOf = db.prepare("SELECT entity_id FROM ledger_accounts WHERE id = ?");
    for (const e of buildTransferEntries(db, view, user.id)) {
      const debits = e.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const credits = e.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      const wrongBook = e.lines.some((l) => (entityOf.get(l.ledgerAccountId) as { entity_id: string } | undefined)?.entity_id !== e.entityId);
      if (debits !== credits || wrongBook) {
        balanced = false;
        detail = e.memo;
      }
    }
  } catch (err) {
    balanced = false;
    detail = err instanceof Error ? err.message : String(err);
  }
  add("balanced", "Every journal entry it would post balances", balanced, detail);

  return checks;
}
