// Consolidated statements: the family's businesses reported as one, the way a
// lender looks at them.
//
// Consolidating = add up every business's books, then ELIMINATE everything the
// businesses did with each other, because the family can't owe itself money or
// earn income from itself. Two kinds of intercompany activity get eliminated:
//
//   1. Balances (from matched transfers). Cedar lent Hollis $12,000: Cedar has a
//      $12,000 receivable, Hollis a $12,000 payable. Combined, both disappear.
//   2. Sales (pasture rent, a hay sale). The Land Co.'s rental income is the
//      ranch's rent expense. Combined, both disappear. Profit doesn't change;
//      revenue and expenses stop being inflated.
//
// Eliminations exist only in this report. Nothing is posted to any business's
// books: each one still files its own taxes on its own numbers.
//
// The report also says whether it can be trusted yet (the "readiness" checks):
// an unreviewed transfer or an unconfirmed sale means the totals are wrong.

import type { DB } from "../db";
import type { CurrentUser } from "../auth";
import { badRequest, conflict, notFound } from "../errors";
import { businessDaysBetween } from "../dates";
import { mentionsEntity } from "../matcher/signals";
import { DEFAULT_CONFIG } from "../matcher/types";
import { OPENING_BALANCE_DATE } from "../org";
import { unmatchedTransactions } from "./books";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportLine = {
  key: string;
  label: string;
  /** Natural sign for the section: income, expenses, assets, liabilities and equity all read positive. */
  byEntity: Record<string, number>;
  eliminationCents: number;
  consolidatedCents: number;
};

export type Section = { title: string; lines: ReportLine[]; total: ReportLine };

export type Elimination = {
  kind: "balance" | "sale";
  title: string;
  detail: string;
  amountCents: number;
};

export type SaleTxn = {
  transactionId: number;
  entityId: string;
  entityName: string;
  accountName: string;
  postedDate: string;
  amountCents: number;
  memo: string;
  category: string;
};

export type SaleCandidate = {
  key: string;
  buyer: SaleTxn;
  seller: SaleTxn;
  status: "pending" | "confirmed" | "dismissed";
  decidedBy: string | null;
};

export type ReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
  /** "block": the totals are wrong until this is fixed. "warn": worth a look, but the report holds. */
  severity: "block" | "warn";
  detail?: string;
  /** Where to go to fix it. */
  action?: "review" | "unmatched" | "sales";
};

export type Consolidation = {
  columns: { id: string; name: string }[];
  periodStart: string;
  periodEnd: string | null;
  income: Section;
  expenses: Section;
  netIncome: ReportLine;
  assets: Section;
  liabilities: Section;
  equity: Section;
  liabilitiesAndEquity: ReportLine;
  eliminations: Elimination[];
  sales: SaleCandidate[];
  readiness: ReadinessCheck[];
  ready: boolean;
};

// ---------------------------------------------------------------------------
// Which businesses: every business the user can see, or a subset they choose
// ---------------------------------------------------------------------------

function selectEntities(db: DB, user: CurrentUser, requested?: string[]) {
  const visible = db
    .prepare(
      `SELECT id, name FROM entities WHERE kind = 'business'
          AND id IN (SELECT entity_id FROM user_entity_access WHERE user_id = ?) ORDER BY name`,
    )
    .all(user.id) as { id: string; name: string }[];
  if (!requested || requested.length === 0) return visible;
  for (const id of requested) {
    // Same 404-not-403 rule as proposals: don't confirm that a hidden business exists.
    if (!visible.some((e) => e.id === id)) throw notFound(`Business "${id}"`);
  }
  return visible.filter((e) => requested.includes(e.id));
}

// ---------------------------------------------------------------------------
// Sales between the businesses: found on read, confirmed by a person
// ---------------------------------------------------------------------------

type CategorizedTxn = SaleTxn & { categoryType: string; categorySlug: string };

/**
 * Pairs that look like one business paying another for something real: same
 * amount, a few business days apart, a real (not uncategorized) expense on one
 * side and income on the other, and at least one memo naming the other
 * business. Transactions already in a live transfer match are excluded.
 *
 * Computed on every read instead of stored like transfer proposals: it's a
 * single pass over a few hundred rows, so it's never stale and needs no job.
 */
export function findSaleCandidates(db: DB, entityIds: string[]): SaleCandidate[] {
  if (entityIds.length < 2) return [];
  const marks = entityIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT t.id AS transactionId, ba.entity_id AS entityId, e.name AS entityName, ba.name AS accountName,
              t.posted_date AS postedDate, t.amount_cents AS amountCents, t.memo,
              la.name AS category, la.type AS categoryType, substr(la.id, instr(la.id, ':') + 1) AS categorySlug
         FROM bank_transactions t
         JOIN bank_accounts ba ON ba.id = t.account_id
         JOIN entities e ON e.id = ba.entity_id
         JOIN journal_entries je ON je.bank_transaction_id = t.id AND je.source = 'bank_import'
         JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN ledger_accounts la ON la.id = jl.ledger_account_id AND la.kind = 'category'
        WHERE ba.entity_id IN (${marks})
          AND NOT EXISTS (SELECT 1 FROM match_legs l WHERE l.transaction_id = t.id AND l.active = 1)
        ORDER BY t.posted_date, t.id`,
    )
    .all(...entityIds) as CategorizedTxn[];

  const isReal = (t: CategorizedTxn) => !t.categorySlug.startsWith("uncategorized");
  const buys = rows.filter((t) => t.amountCents < 0 && t.categoryType === "expense" && isReal(t));
  const sells = rows.filter((t) => t.amountCents > 0 && t.categoryType === "income" && isReal(t));

  const decisions = new Map(
    (
      db.prepare("SELECT buyer_txn_id, seller_txn_id, status, decided_by FROM intercompany_sales").all() as {
        buyer_txn_id: number;
        seller_txn_id: number;
        status: "confirmed" | "dismissed";
        decided_by: string;
      }[]
    ).map((d) => [`${d.buyer_txn_id}-${d.seller_txn_id}`, d]),
  );

  // Every plausible pair, closest dates first; then one-to-one.
  type Pair = { buyer: CategorizedTxn; seller: CategorizedTxn; gap: number };
  const pairs: Pair[] = [];
  for (const buyer of buys) {
    for (const seller of sells) {
      if (seller.entityId === buyer.entityId || seller.amountCents !== -buyer.amountCents) continue;
      const gap = businessDaysBetween(buyer.postedDate, seller.postedDate);
      if (gap < -DEFAULT_CONFIG.maxEarlyBusinessDays || gap > DEFAULT_CONFIG.windowBusinessDays) continue;
      const named =
        mentionsEntity(buyer.memo, { id: seller.entityId, name: seller.entityName }) ||
        mentionsEntity(seller.memo, { id: buyer.entityId, name: buyer.entityName });
      if (named) pairs.push({ buyer, seller, gap });
    }
  }
  // A decided pair keeps its partners, so confirmed/dismissed pairs go first.
  const decided = (p: Pair) => decisions.has(`${p.buyer.transactionId}-${p.seller.transactionId}`);
  pairs.sort(
    (a, b) =>
      Number(decided(b)) - Number(decided(a)) ||
      Math.abs(a.gap) - Math.abs(b.gap) ||
      a.buyer.transactionId - b.buyer.transactionId ||
      a.seller.transactionId - b.seller.transactionId,
  );
  const used = new Set<number>();
  const out: SaleCandidate[] = [];
  const strip = ({ categoryType, categorySlug, ...t }: CategorizedTxn): SaleTxn => t;
  for (const p of pairs) {
    if (used.has(p.buyer.transactionId) || used.has(p.seller.transactionId)) continue;
    used.add(p.buyer.transactionId);
    used.add(p.seller.transactionId);
    const key = `${p.buyer.transactionId}-${p.seller.transactionId}`;
    const d = decisions.get(key);
    out.push({ key, buyer: strip(p.buyer), seller: strip(p.seller), status: d?.status ?? "pending", decidedBy: d?.decided_by ?? null });
  }
  return out.sort((a, b) => a.buyer.postedDate.localeCompare(b.buyer.postedDate) || a.key.localeCompare(b.key));
}

/** Confirm, dismiss, or clear the decision on a pair. Needs access to both businesses. */
export function decideSale(
  db: DB,
  user: CurrentUser,
  buyerTxnId: number,
  sellerTxnId: number,
  decision: "confirmed" | "dismissed" | "undecided",
): void {
  if (!["confirmed", "dismissed", "undecided"].includes(decision)) throw badRequest(`Unknown decision "${decision}"`);
  db.transaction(() => {
    const entityOf = (id: number) =>
      (
        db
          .prepare("SELECT ba.entity_id AS entityId FROM bank_transactions t JOIN bank_accounts ba ON ba.id = t.account_id WHERE t.id = ?")
          .get(id) as { entityId: string } | undefined
      )?.entityId;
    const buyerEntity = entityOf(buyerTxnId);
    const sellerEntity = entityOf(sellerTxnId);
    if (!buyerEntity || !sellerEntity || !user.entityIds.includes(buyerEntity) || !user.entityIds.includes(sellerEntity)) {
      throw notFound("Transaction");
    }
    // Only pairs the detector would offer: stops arbitrary pairs being eliminated.
    const candidate = findSaleCandidates(db, [buyerEntity, sellerEntity]).find(
      (c) => c.buyer.transactionId === buyerTxnId && c.seller.transactionId === sellerTxnId,
    );
    if (!candidate) throw conflict("These two transactions aren't a possible sale between your businesses anymore");

    db.prepare("DELETE FROM intercompany_sales WHERE buyer_txn_id = ? AND seller_txn_id = ?").run(buyerTxnId, sellerTxnId);
    if (decision !== "undecided") {
      db.prepare("INSERT INTO intercompany_sales (buyer_txn_id, seller_txn_id, status, decided_by) VALUES (?, ?, ?, ?)").run(
        buyerTxnId,
        sellerTxnId,
        decision,
        user.id,
      );
    }
    db.prepare("INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)").run(
      user.id,
      `sale_${decision}`,
      JSON.stringify({
        buyerTxnId,
        sellerTxnId,
        amountCents: candidate.seller.amountCents,
        buyer: candidate.buyer.entityName,
        seller: candidate.seller.entityName,
        // Lets the activity log hide this row from anyone who can't see both businesses.
        entityIds: [buyerEntity, sellerEntity],
      }),
    );
  }).immediate();
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Balance = {
  entityId: string;
  ledgerId: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  kind: string;
  counterparty: string | null;
  counterpartyName: string | null;
  /** debits - credits */
  net: number;
};

export function consolidate(db: DB, user: CurrentUser, requested?: string[]): Consolidation {
  const columns = selectEntities(db, user, requested);
  const ids = columns.map((c) => c.id);
  const inGroup = new Set(ids);
  const marks = ids.map(() => "?").join(",") || "NULL";

  const balances = db
    .prepare(
      `SELECT la.entity_id AS entityId, la.id AS ledgerId, la.name, la.type, la.kind,
              la.counterparty_entity_id AS counterparty, o.name AS counterpartyName,
              coalesce(sum(jl.debit_cents - jl.credit_cents), 0) AS net
         FROM ledger_accounts la
         LEFT JOIN entities o ON o.id = la.counterparty_entity_id
         LEFT JOIN journal_lines jl ON jl.ledger_account_id = la.id
        WHERE la.entity_id IN (${marks})
        GROUP BY la.id`,
    )
    .all(...ids) as Balance[];

  // Lines are keyed so the same account on different businesses lands on one row.
  const lineKey = (b: Balance) => {
    if (b.kind === "cash") return "cash";
    if (b.kind === "due_from" || b.kind === "due_to") return `${b.kind}:${b.counterparty}`;
    return b.ledgerId.slice(b.ledgerId.indexOf(":") + 1);
  };
  const lineLabel = (b: Balance) => (b.kind === "cash" ? "Cash" : b.name);

  const sections = new Map<string, Map<string, ReportLine>>();
  const lineFor = (section: string, key: string, label: string) => {
    if (!sections.has(section)) sections.set(section, new Map());
    const lines = sections.get(section)!;
    if (!lines.has(key)) {
      lines.set(key, { key, label, byEntity: Object.fromEntries(ids.map((id) => [id, 0])), eliminationCents: 0, consolidatedCents: 0 });
    }
    return lines.get(key)!;
  };
  // Natural sign: debit-normal sections (assets, expenses) read net; credit-normal ones read -net.
  const SECTION: Record<Balance["type"], [string, 1 | -1]> = {
    income: ["income", -1],
    expense: ["expenses", 1],
    asset: ["assets", 1],
    liability: ["liabilities", -1],
    equity: ["equity", -1],
  };
  for (const b of balances) {
    const [section, sign] = SECTION[b.type];
    lineFor(section, lineKey(b), lineLabel(b)).byEntity[b.entityId] += sign * b.net || 0;
  }

  // ---- Eliminations ---------------------------------------------------------
  const eliminations: Elimination[] = [];
  const nameOf = (id: string) => columns.find((c) => c.id === id)?.name ?? id;
  const mismatches: string[] = [];

  // 1. Balances between two businesses that are both in the group.
  for (const lender of ids) {
    for (const borrower of ids) {
      if (lender === borrower) continue;
      const receivable = lineFor("assets", `due_from:${borrower}`, `Due from ${nameOf(borrower)}`).byEntity[lender];
      const payable = lineFor("liabilities", `due_to:${lender}`, `Due to ${nameOf(lender)}`).byEntity[borrower];
      if (receivable === 0 && payable === 0) continue;
      if (receivable !== payable) {
        mismatches.push(
          `${nameOf(lender)} says ${nameOf(borrower)} owes $${(receivable / 100).toFixed(2)}; ${nameOf(borrower)} says $${(payable / 100).toFixed(2)}`,
        );
      }
      // Eliminate what both sides agree on; any difference stays visible (and blocks readiness).
      const amount = Math.min(receivable, payable);
      if (amount <= 0) continue;
      lineFor("assets", `due_from:${borrower}`, "").eliminationCents -= amount;
      lineFor("liabilities", `due_to:${lender}`, "").eliminationCents -= amount;
      eliminations.push({
        kind: "balance",
        title: `${nameOf(borrower)} owes ${nameOf(lender)}`,
        detail: `A receivable on ${nameOf(lender)}'s books and a payable on ${nameOf(borrower)}'s. Within the family it's zero.`,
        amountCents: amount,
      });
    }
  }

  // 2. Confirmed sales between two businesses in the group, grouped so three
  //    months of rent reads as one line.
  const sales = findSaleCandidates(db, ids);
  const groups = new Map<string, SaleCandidate[]>();
  for (const s of sales.filter((s) => s.status === "confirmed")) {
    const key = [s.buyer.entityId, s.seller.entityId, s.buyer.category, s.seller.category].join("|");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const lineByLabel = (section: string, label: string) => [...(sections.get(section)?.values() ?? [])].find((l) => l.label === label);
  for (const group of groups.values()) {
    const { buyer, seller } = group[0];
    const cents = group.reduce((sum, s) => sum + s.seller.amountCents, 0);
    const incomeLine = lineByLabel("income", seller.category);
    const expenseLine = lineByLabel("expenses", buyer.category);
    if (!incomeLine || !expenseLine) continue;
    incomeLine.eliminationCents -= cents;
    expenseLine.eliminationCents -= cents;
    const payments = group.length === 1 ? `one payment, ${prettyDate(buyer.postedDate)}` : `${group.length} payments`;
    eliminations.push({
      kind: "sale",
      title: `${buyer.entityName} paid ${seller.entityName}`,
      detail: `${seller.category} to one, ${buyer.category} to the other (${payments}). Revenue and expenses both shrink; profit doesn't change.`,
      amountCents: cents,
    });
  }

  // ---- Totals ----------------------------------------------------------------
  const finish = (line: ReportLine) => {
    line.consolidatedCents = Object.values(line.byEntity).reduce((s, x) => s + x, 0) + line.eliminationCents;
    return line;
  };
  const sumLines = (key: string, label: string, lines: ReportLine[], sign = 1): ReportLine => {
    const total: ReportLine = { key, label, byEntity: Object.fromEntries(ids.map((id) => [id, 0])), eliminationCents: 0, consolidatedCents: 0 };
    for (const l of lines) {
      for (const id of ids) total.byEntity[id] += sign * l.byEntity[id];
      total.eliminationCents += sign * l.eliminationCents;
    }
    return finish(total);
  };
  const shown = (section: string, keep: (l: ReportLine) => boolean = () => true) =>
    [...(sections.get(section)?.values() ?? [])]
      .map(finish)
      .filter((l) => keep(l) && (Object.values(l.byEntity).some((x) => x !== 0) || l.eliminationCents !== 0))
      .sort((a, b) => b.consolidatedCents - a.consolidatedCents || a.label.localeCompare(b.label));

  const incomeLines = shown("income");
  const expenseLines = shown("expenses");
  const income: Section = { title: "Income", lines: incomeLines, total: sumLines("total_income", "Total income", incomeLines) };
  const expenses: Section = { title: "Expenses", lines: expenseLines, total: sumLines("total_expenses", "Total expenses", expenseLines) };
  const netIncome = sumLines("net_income", "Net income", [income.total]);
  for (const id of ids) netIncome.byEntity[id] -= expenses.total.byEntity[id];
  netIncome.eliminationCents -= expenses.total.eliminationCents;
  finish(netIncome);

  // Assets read in a fixed order: cash first, then what others owe.
  const assetOrder = (l: ReportLine) => (l.key === "cash" ? 0 : l.key === "transfers_in_transit" ? 1 : 2);
  const assetLines = shown("assets").sort((a, b) => assetOrder(a) - assetOrder(b) || a.label.localeCompare(b.label));
  const liabilityLines = shown("liabilities").sort((a, b) => a.label.localeCompare(b.label));
  // Equity: what was carried in, owner moves, and this period's profit (the books aren't closed yet).
  const equityLines = [...shown("equity"), { ...netIncome, key: "net_income", label: "Net income this period", byEntity: { ...netIncome.byEntity } }];
  const assets: Section = { title: "Assets", lines: assetLines, total: sumLines("total_assets", "Total assets", assetLines) };
  const liabilities: Section = {
    title: "Liabilities",
    lines: liabilityLines,
    total: sumLines("total_liabilities", "Total liabilities", liabilityLines),
  };
  const equity: Section = { title: "Equity", lines: equityLines, total: sumLines("total_equity", "Total equity", equityLines) };
  const liabilitiesAndEquity = sumLines("total_liabilities_equity", "Total liabilities and equity", [liabilities.total, equity.total]);

  // ---- Readiness ---------------------------------------------------------------
  const readiness: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => readiness.push(c);
  const $ = (cents: number) => `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;

  const pending = db
    .prepare(
      `SELECT count(DISTINCT p.id) AS n, coalesce(sum(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS cents
         FROM match_proposals p
         JOIN match_legs l ON l.proposal_id = p.id
         JOIN bank_transactions t ON t.id = l.transaction_id
         JOIN bank_accounts ba ON ba.id = t.account_id
        WHERE p.status = 'proposed' AND ba.entity_id IN (${marks})`,
    )
    .get(...ids) as { n: number; cents: number };
  add({
    id: "transfers",
    label: "Every proposed transfer has been reviewed",
    ok: pending.n === 0,
    severity: "block",
    detail: pending.n ? `${pending.n} waiting. Until then, about ${$(pending.cents)} of money moving between accounts counts as income or expense.` : undefined,
    action: "review",
  });

  const undecided = sales.filter((s) => s.status === "pending");
  add({
    id: "sales",
    label: "Sales between your businesses are confirmed or dismissed",
    ok: undecided.length === 0,
    severity: "block",
    detail: undecided.length
      ? `${undecided.length} to decide, ${$(undecided.reduce((s, x) => s + x.seller.amountCents, 0))} that may be counted twice as both income and expense.`
      : undefined,
    action: "sales",
  });

  add({
    id: "intercompany",
    label: "Both sides agree on what each business owes the other",
    ok: mismatches.length === 0,
    severity: "block",
    detail: mismatches.join(". ") || undefined,
  });

  const unbalanced = (
    db
      .prepare(
        `SELECT count(*) AS n FROM unbalanced_entries u JOIN journal_entries je ON je.id = u.entry_id WHERE je.entity_id IN (${marks})`,
      )
      .get(...ids) as { n: number }
  ).n;
  const sheetBalances = ids.every((id) => assets.total.byEntity[id] === liabilitiesAndEquity.byEntity[id]) && assets.total.consolidatedCents === liabilitiesAndEquity.consolidatedCents;
  add({
    id: "balanced",
    label: "Every entry balances, and assets equal liabilities plus equity",
    ok: unbalanced === 0 && sheetBalances,
    severity: "block",
    detail: unbalanced ? `${unbalanced} unbalanced entries` : sheetBalances ? undefined : "The balance sheet doesn't balance",
  });

  const unexplained = unmatchedTransactions(db, user).filter(
    (t) => inGroup.has(t.entityId) && t.category.startsWith("Uncategorized"),
  );
  const waiting = unexplained.filter((t) => t.awaitingCounterpart).length;
  add({
    id: "unexplained",
    label: "No uncategorized money moving in or out",
    ok: unexplained.length === 0,
    severity: "warn",
    detail: unexplained.length
      ? `${unexplained.length} transactions, ${$(unexplained.reduce((s, t) => s + Math.abs(t.amountCents), 0))}. Some may be transfers the matcher missed${waiting ? `; ${waiting} may still be waiting for the other side` : ""}.`
      : undefined,
    action: "unmatched",
  });

  const periodEnd = (
    db.prepare(`SELECT max(t.posted_date) AS d FROM bank_transactions t JOIN bank_accounts ba ON ba.id = t.account_id WHERE ba.entity_id IN (${marks})`).get(...ids) as {
      d: string | null;
    }
  ).d;

  return {
    columns,
    periodStart: OPENING_BALANCE_DATE,
    periodEnd,
    income,
    expenses,
    netIncome,
    assets,
    liabilities,
    equity,
    liabilitiesAndEquity,
    eliminations,
    sales,
    readiness,
    ready: readiness.every((c) => c.ok || c.severity === "warn"),
  };
}
