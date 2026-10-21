"use client";

import { useEffect, useState } from "react";
import {
  arrivalLabel,
  gapLabel,
  isAgainst,
  money,
  moneyWhole,
  plainEffects,
  shortDate,
  timeAgo,
  type AppState,
  type BooksSummary,
  type LegView,
  type ProposalView,
  type UnmatchedTxn,
} from "./lib";

export type View = "review" | "unmatched" | "books" | "history";

// ---------------------------------------------------------------------------
// Icons (16px, stroke-based)
// ---------------------------------------------------------------------------

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS: Record<View, string> = {
  review: "M2 4.5h4l1 2h2l1-2h4M2 4.5v7h12v-7M4 2h8",
  unmatched: "M2.5 4h11M2.5 8h11M2.5 12h7",
  books: "M3 2.5h8.5v11H3zM5.5 5.5h3.5M5.5 8h3.5M13 4.5v9",
  history: "M8 4.5V8l2.5 1.5M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5",
};

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export function Sidebar(props: {
  state: AppState;
  view: View;
  onView: (v: View) => void;
  userId: string;
  onUser: (id: string) => void;
  onReset: () => void;
}) {
  const { state } = props;
  const items: [View, string, number | null][] = [
    ["review", "Review", state.proposals.length || null],
    ["unmatched", "Unmatched", state.counts.bankTransactions ? state.unmatched.length : null],
    ["books", "Books", null],
    ["history", "History", null],
  ];
  return (
    <aside className="sidebar">
      <div className="org">
        <div className="app">Transfer Matcher</div>
        <div className="names">{state.books.entities.map((e) => e.entityName).join(", ")}</div>
      </div>
      <nav className="nav" aria-label="Main">
        {items.map(([id, label, n]) => (
          <button key={id} aria-current={props.view === id ? "page" : undefined} onClick={() => props.onView(id)}>
            <Icon d={ICONS[id]} />
            {label}
            {n !== null && <span className="n">{n}</span>}
          </button>
        ))}
      </nav>
      <div className="bottom">
        <label>
          Signed in as
          <select value={props.userId} onChange={(e) => props.onUser(e.target.value)}>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <button className="linkish" onClick={props.onReset}>
          Reset demo data
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Summary strip: the outcome, always visible on the Review page
// ---------------------------------------------------------------------------

export function Summary({ books }: { books: BooksSummary }) {
  const removed = books.entities.reduce((s, e) => s + e.incomeBeforeCents - e.incomeNowCents, 0);
  const owed = books.entities
    .map((e) => ({
      e,
      net: e.dueFrom.reduce((s, d) => s + d.cents, 0) - e.dueTo.reduce((s, d) => s + d.cents, 0),
      other: e.dueFrom[0]?.otherEntityName ?? e.dueTo[0]?.otherEntityName,
    }))
    .find((x) => x.net !== 0);
  const healthy =
    books.unbalancedEntries === 0 &&
    (books.intercompanyNetCents ?? 0) === 0 &&
    books.entities.every((e) => e.transfersInTransitCents === 0);
  return (
    <div className="summary">
      <div>
        <div className="k">Transfers taken out of income</div>
        <div className="v">{moneyWhole(removed)}</div>
      </div>
      <div>
        <div className="k">
          {owed
            ? owed.net > 0
              ? `${owed.other} owes ${owed.e.entityName}`
              : `${owed.e.entityName} owes ${owed.other}`
            : "Owed between your businesses"}
        </div>
        <div className="v">{moneyWhole(owed ? Math.abs(owed.net) : 0)}</div>
      </div>
      <div>
        <div className="k">Books check</div>
        <div className={`v ${healthy ? "ok" : "bad"}`}>{healthy ? "✓ Balanced" : "✗ Needs attention"}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review table
// ---------------------------------------------------------------------------

function side(legs: LegView[]) {
  if (legs.length === 1) return { title: `${legs[0].accountName} ...${legs[0].last4}`, sub: legs[0].entityName };
  const entities = [...new Set(legs.map((l) => l.entityName))].join(", ");
  return { title: `${legs.length} accounts`, sub: entities };
}

const outs = (p: ProposalView) => p.legs.filter((l) => l.direction === "out");
const ins = (p: ProposalView) => p.legs.filter((l) => l.direction === "in");

function SelectAll({ ids, selected, onChange }: { ids: number[]; selected: number[]; onChange: (ids: number[]) => void }) {
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  const some = !all && ids.some((id) => selected.includes(id));
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={all}
      ref={(el) => {
        if (el) el.indeterminate = some;
      }}
      onChange={() => onChange(all ? [] : ids)}
    />
  );
}

export function ReviewTable(props: {
  proposals: ProposalView[];
  selected: number[];
  onSelect: (ids: number[]) => void;
  openId: number | null;
  onOpen: (id: number) => void;
}) {
  const { proposals, selected } = props;
  const toggle = (id: number) => props.onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th className="check">
              <SelectAll ids={proposals.map((p) => p.id)} selected={selected} onChange={props.onSelect} />
            </th>
            <th>Date</th>
            <th>From</th>
            <th>To</th>
            <th className="num">Amount</th>
            <th>Match</th>
          </tr>
        </thead>
        <tbody>
          {proposals.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>Nothing to review here.</td>
            </tr>
          )}
          {proposals.map((p) => {
            const from = side(outs(p));
            const to = side(ins(p));
            return (
              <tr
                key={p.id}
                className={`${selected.includes(p.id) ? "is-selected" : ""} ${props.openId === p.id ? "is-open" : ""}`}
                onClick={() => props.onOpen(p.id)}
              >
                <td className="check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select match ${p.id}`} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                </td>
                <td className="date">
                  {shortDate(outs(p)[0].postedDate)}
                  <span className="sub">{gapLabel(p) === "same day" || gapLabel(p).endsWith("early") ? gapLabel(p) : `+${gapLabel(p)}`}</span>
                </td>
                <td>
                  {from.title}
                  <span className="sub">{from.sub}</span>
                </td>
                <td>
                  {to.title}
                  <span className="sub">{to.sub}</span>
                </td>
                <td className="num">{money(p.totalCents)}</td>
                <td>
                  <span className={`pill ${p.tier === "high" ? "strong" : "review"}`}>{p.tier === "high" ? "Strong" : "Check"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------------

const OUTCOME: Record<string, string> = { applied: "Accepted", rejected: "Not a transfer", reversed: "Undone" };

export function HistoryTable(props: {
  decided: ProposalView[];
  users: AppState["users"];
  openId: number | null;
  onOpen: (id: number) => void;
  onUndo: (p: ProposalView) => void;
  busy: boolean;
}) {
  const who = (id: string | null) => props.users.find((u) => u.id === id)?.name.split(" ")[0] ?? id ?? "";
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th>Decided</th>
            <th>From</th>
            <th>To</th>
            <th className="num">Amount</th>
            <th>Outcome</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.decided.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>Nothing decided yet.</td>
            </tr>
          )}
          {props.decided.map((p) => {
            const from = side(outs(p));
            const to = side(ins(p));
            return (
              <tr key={p.id} className={props.openId === p.id ? "is-open" : ""} onClick={() => props.onOpen(p.id)}>
                <td className="date">
                  {p.decidedAt ? timeAgo(p.decidedAt) : ""}
                  <span className="sub">{who(p.decidedBy)}</span>
                </td>
                <td>
                  {from.title}
                  <span className="sub">{from.sub}</span>
                </td>
                <td>
                  {to.title}
                  <span className="sub">{to.sub}</span>
                </td>
                <td className="num">{money(p.totalCents)}</td>
                <td>
                  <span className={`pill ${p.status}`}>{p.source === "manual" && p.status === "applied" ? "Matched by hand" : OUTCOME[p.status] ?? p.status}</span>
                </td>
                <td className="num" onClick={(e) => e.stopPropagation()}>
                  {p.status === "applied" && (
                    <button className="btn ghost" disabled={props.busy} onClick={() => props.onUndo(p)}>
                      Undo
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer for one match
// ---------------------------------------------------------------------------

const REJECT_REASONS = ["Not the same money", "One side is a real purchase or sale", "Wrong pairing"];

function Leg({ leg }: { leg: LegView }) {
  return (
    <div className="leg">
      <div className="top">
        <div>
          <div className="acct">
            {leg.accountName} ...{leg.last4}
          </div>
          <div className="ent">
            {leg.entityName}, {shortDate(leg.postedDate)}
          </div>
        </div>
        <div className="amt">
          {leg.amountCents < 0 ? "−" : "+"}
          {money(Math.abs(leg.amountCents))}
        </div>
      </div>
      <div className="memo">{leg.memo}</div>
      <div className="booked">Booked as {leg.importCategory}</div>
    </div>
  );
}

export function Drawer(props: {
  p: ProposalView;
  busy: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: (reason: string) => void;
  onUndo: () => void;
}) {
  const { p } = props;
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => setRejecting(false), [p.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  const open = p.status === "proposed";

  return (
    <aside className="drawer" aria-label={`Match details`}>
      <div className="drawer-head">
        <div>
          <h2>{money(p.totalCents)} transfer</h2>
          <div className="meta">
            {open && <span className={`pill ${p.tier === "high" ? "strong" : "review"}`}>{p.tier === "high" ? "Strong match" : "Check this one"}</span>}
            {!open && <span className={`pill ${p.status}`}>{OUTCOME[p.status] ?? p.status}</span>}
            <span className="pill">{p.kind === "intercompany" ? "Between your businesses" : "Between your accounts"}</span>
            {p.source === "matcher" && <span className="pill">Score {p.confidence.toFixed(2)}</span>}
          </div>
        </div>
        <button className="btn ghost close" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="drawer-body">
        <div>
          <h3>Bank activity</h3>
          <div className="legs">
            <div className="leg-group">
              {outs(p).map((l) => (
                <Leg key={l.transactionId} leg={l} />
              ))}
            </div>
            <div className="gap">{arrivalLabel(p)}</div>
            <div className="leg-group">
              {ins(p).map((l) => (
                <Leg key={l.transactionId} leg={l} />
              ))}
            </div>
          </div>
        </div>

        <div>
          <h3>Why this looks like a transfer</h3>
          <ul className="checklist">
            {p.reasons.map((r) => (
              <li key={r}>
                <span className={`mark ${isAgainst(r) ? "bad" : "ok"}`}>{isAgainst(r) ? "✗" : "✓"}</span>
                {r}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>{open ? "If you accept" : "What changed in your books"}</h3>
          <ul className="effects">
            {plainEffects(p).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="drawer-foot">
        {open && !rejecting && (
          <>
            <button className="btn" disabled={props.busy} onClick={() => setRejecting(true)}>
              Not a transfer
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={props.busy} onClick={props.onAccept}>
              Accept match
            </button>
          </>
        )}
        {open && rejecting && (
          <div className="reasons-pick">
            <span>What&apos;s wrong with it?</span>
            <div className="row">
              {REJECT_REASONS.map((r) => (
                <button key={r} className="btn" disabled={props.busy} onClick={() => props.onReject(r)}>
                  {r}
                </button>
              ))}
              <button className="btn ghost" onClick={() => setRejecting(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {!open && (
          <>
            <span className="hint" style={{ margin: 0 }}>
              {p.status === "applied" && "Undo posts reversing entries. Nothing is deleted."}
              {p.status === "rejected" && "This pairing won't be suggested again."}
              {p.status === "reversed" && "Reversed. The original entries stay in the audit trail."}
            </span>
            <span className="spacer" />
            {p.status === "applied" && (
              <button className="btn" disabled={props.busy} onClick={props.onUndo}>
                Undo
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Unmatched transactions
// ---------------------------------------------------------------------------

export function UnmatchedTable(props: {
  txns: UnmatchedTxn[];
  selected: number[];
  onSelect: (ids: number[]) => void;
}) {
  const { txns, selected } = props;
  const toggle = (id: number) => props.onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th className="check">
              <SelectAll ids={txns.map((t) => t.id)} selected={selected} onChange={props.onSelect} />
            </th>
            <th>Date</th>
            <th>Account</th>
            <th>Description</th>
            <th>Category</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {txns.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>Nothing left unmatched.</td>
            </tr>
          )}
          {txns.map((t) => (
            <tr key={t.id} className={selected.includes(t.id) ? "is-selected" : ""} onClick={() => toggle(t.id)}>
              <td className="check" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label={`Select ${t.memo}`} checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
              </td>
              <td className="date">{shortDate(t.postedDate)}</td>
              <td>
                {t.accountName} ...{t.last4}
                <span className="sub">{t.entityName}</span>
              </td>
              <td>
                {t.memo}
                {t.awaitingCounterpart && <span className="sub">Other side may not have arrived yet</span>}
              </td>
              <td>
                <span className="pill">{t.category}</span>
              </td>
              <td className={`num ${t.amountCents > 0 ? "amt-in" : ""}`}>
                {t.amountCents > 0 ? "+" : "−"}
                {money(Math.abs(t.amountCents))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export function BooksView({ books }: { books: BooksSummary }) {
  return (
    <div className="books">
      {books.entities.map((e) => (
        <section className="book" key={e.entityId}>
          <h2>{e.entityName}</h2>
          <div className="line">
            <span className="l">Income</span>
            <span className="r">
              {e.incomeBeforeCents !== e.incomeNowCents && <span className="was">{moneyWhole(e.incomeBeforeCents)}</span>}
              {moneyWhole(e.incomeNowCents)}
            </span>
          </div>
          <div className="line">
            <span className="l">Expenses</span>
            <span className="r">
              {e.expenseBeforeCents !== e.expenseNowCents && <span className="was">{moneyWhole(e.expenseBeforeCents)}</span>}
              {moneyWhole(e.expenseNowCents)}
            </span>
          </div>
          {e.dueFrom.map((d) => (
            <div className="line" key={`f-${d.otherEntityName}`}>
              <span className="l">Owed by {d.otherEntityName}</span>
              <span className="r">{moneyWhole(d.cents)}</span>
            </div>
          ))}
          {e.dueTo.map((d) => (
            <div className="line" key={`t-${d.otherEntityName}`}>
              <span className="l">Owed to {d.otherEntityName}</span>
              <span className="r">{moneyWhole(d.cents)}</span>
            </div>
          ))}
          <div className="line">
            <span className="l">Transfers in transit</span>
            <span className="r">{moneyWhole(e.transfersInTransitCents)}</span>
          </div>
        </section>
      ))}
      <section className="book">
        <h2>Checks</h2>
        <div className="line">
          <span className="l">Every entry balances</span>
          <span className={`r ${books.unbalancedEntries === 0 ? "ok" : "bad"}`}>{books.unbalancedEntries === 0 ? "✓" : `✗ ${books.unbalancedEntries}`}</span>
        </div>
        {books.intercompanyNetCents !== null && (
          <div className="line">
            <span className="l">Amounts owed between businesses net to zero</span>
            <span className={`r ${books.intercompanyNetCents === 0 ? "ok" : "bad"}`}>
              {books.intercompanyNetCents === 0 ? "✓" : `✗ ${money(books.intercompanyNetCents)}`}
            </span>
          </div>
        )}
        <div className="line">
          <span className="l">Nothing stuck in transit</span>
          <span className={`r ${books.entities.every((e) => e.transfersInTransitCents === 0) ? "ok" : "bad"}`}>
            {books.entities.every((e) => e.transfersInTransitCents === 0) ? "✓" : "✗"}
          </span>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export function Activity({ audit, users }: { audit: AppState["audit"]; users: AppState["users"] }) {
  const who = (actor: string) =>
    actor.startsWith("system") ? "Matcher" : (users.find((u) => u.id === actor)?.name.split(" ")[0] ?? actor);
  const rows = groupAccepts(audit.filter(isNews)).slice(0, 12);
  const describe = (a: (typeof rows)[number]) => {
    const d = a.details ? JSON.parse(a.details) : {};
    if (a.count > 1) return `${who(a.actor)} accepted ${a.count} matches`;
    switch (a.action) {
      case "bank_sync":
        return `${who(a.actor)} synced the bank: ${d.inserted} new transactions`;
      case "match_run":
        return `${who(a.actor)} found ${d.created} new match${d.created === 1 ? "" : "es"}`;
      case "accept":
        return `${who(a.actor)} accepted match #${a.proposal_id}`;
      case "reject":
        return `${who(a.actor)} marked #${a.proposal_id} not a transfer (${d.reason})`;
      case "undo":
        return `${who(a.actor)} undid match #${a.proposal_id}`;
      case "manual_match":
        return `${who(a.actor)} matched #${a.proposal_id} by hand`;
      default:
        return `${who(a.actor)}: ${a.action}`;
    }
  };
  if (rows.length === 0) return null;
  return (
    <ul className="activity">
      {rows.map((a) => (
        <li key={a.id}>
          <span>{describe(a)}</span>
          <span className="when">{timeAgo(a.at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A matcher run that changed nothing isn't worth a line. */
function isNews(a: AppState["audit"][number]) {
  if (a.action !== "match_run" || !a.details) return true;
  const d = JSON.parse(a.details);
  return d.created > 0 || d.superseded > 0;
}

/** "Accept 20" writes 20 audit rows; show them as one line. */
function groupAccepts(audit: AppState["audit"]) {
  const out: (AppState["audit"][number] & { count: number })[] = [];
  for (const a of audit) {
    const last = out[out.length - 1];
    if (last && a.action === "accept" && last.action === "accept" && last.actor === a.actor) last.count++;
    else out.push({ ...a, count: 1 });
  }
  return out;
}
