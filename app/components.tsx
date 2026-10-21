"use client";

import { useEffect, useState } from "react";
import {
  KIND_LABEL,
  arrivalLabel,
  gapLabel,
  linkingTokens,
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
import type { CaseLeg, Diagnostics } from "@/lib/diagnostics";
import { AmButton, AmCheckList, AmKindPill, AmMoney, AmPill, AmStatusPill, AmTierPill, type AmPillTone } from "@/design-system";
import type { Consolidation, ReportLine, SaleCandidate, Section } from "@/lib/services/consolidation";

export type View = "review" | "unmatched" | "history" | "books" | "consolidated" | "diagnostics";

// ---------------------------------------------------------------------------
// Icons (16px, stroke-based)
// ---------------------------------------------------------------------------

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON = {
  home: "M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5",
  ledger: "M2.5 4h11M2.5 8h11M2.5 12h7",
  transfers: "M3 5.5h9.5L10 3M13 10.5H3.5L6 13",
  bills: "M4 2.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2zM6 6h4M6 8.5h4",
  invoices: "M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3",
  wallet: "M2.5 5h11v8h-11zM2.5 5l8-2.5V5M10.5 9h1",
  reports: "M3 13V8M6.5 13V4M10 13V7M13.5 13V2.5",
  internal: "M8 2.5l5 2v4c0 2.8-2.2 4.6-5 5-2.8-.4-5-2.2-5-5v-4z",
  components: "M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z",
};

// ---------------------------------------------------------------------------
// Sidebar: the transfer matcher is one tool inside a larger bookkeeping app.
// Other sections are shown (disabled) so it reads in context.
// ---------------------------------------------------------------------------

function NavItem(props: { icon: string; label: string; disabled?: boolean; active?: boolean; count?: number | null; onClick?: () => void }) {
  return (
    <button
      className={`nav-item ${props.disabled ? "is-disabled" : ""}`}
      aria-current={props.active ? "page" : undefined}
      aria-disabled={props.disabled || undefined}
      title={props.disabled ? "Not part of this demo" : undefined}
      onClick={props.disabled ? undefined : props.onClick}
    >
      <Icon d={props.icon} />
      <span>{props.label}</span>
      {props.count ? <span className="n">{props.count}</span> : null}
    </button>
  );
}

function SubItem(props: { label: string; active: boolean; count?: number | null; onClick: () => void }) {
  return (
    <button className="nav-sub" aria-current={props.active ? "page" : undefined} onClick={props.onClick}>
      <span>{props.label}</span>
      {props.count ? <span className="n">{props.count}</span> : null}
    </button>
  );
}

export function Sidebar(props: {
  state: AppState;
  view: View;
  onView: (v: View) => void;
  userId: string;
  onUser: (id: string) => void;
  onReset: () => void;
}) {
  const { state, view } = props;
  const user = state.users.find((u) => u.id === props.userId);
  const initials = (name: string) =>
    name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("");
  const entities = state.entities;
  return (
    <aside className="sidebar">
      <details className="org">
        <summary>
          <span className="org-mark">HF</span>
          <span className="org-text">
            <span className="app">Hollis Family</span>
            <span className="names">
              {entities.length} {entities.length === 1 ? "entity" : "entities"}
            </span>
          </span>
          <svg viewBox="0 0 16 16" className="chev" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </summary>
        <ul>
          {entities.map((e) => (
            <li key={e.id}>
              {e.name}
              {e.kind === "personal" && <span> (personal)</span>}
            </li>
          ))}
        </ul>
      </details>

      <nav className="nav" aria-label="Main">
        <NavItem icon={ICON.home} label="Home" disabled />
        <NavItem icon={ICON.ledger} label="Ledger" disabled />
        <NavItem icon={ICON.transfers} label="Transfers" active={["review", "unmatched", "history"].includes(view)} onClick={() => props.onView("review")} />
        <div className="nav-group">
          <SubItem label="Review" active={view === "review"} count={state.proposals.length} onClick={() => props.onView("review")} />
          <SubItem
            label="Unmatched"
            active={view === "unmatched"}
            count={state.counts.bankTransactions ? state.unmatched.filter((t) => t.entityKind === "business" && t.category.startsWith("Uncategorized")).length : null}
            onClick={() => props.onView("unmatched")}
          />
          <SubItem label="History" active={view === "history"} onClick={() => props.onView("history")} />
        </div>
        <NavItem icon={ICON.bills} label="Bills" disabled />
        <NavItem icon={ICON.invoices} label="Invoices" disabled />
        <NavItem icon={ICON.wallet} label="Wallet" disabled />
        <NavItem icon={ICON.reports} label="Reports" active={view === "books" || view === "consolidated"} onClick={() => props.onView("consolidated")} />
        <div className="nav-group">
          <SubItem label="Consolidated" active={view === "consolidated"} onClick={() => props.onView("consolidated")} />
          <SubItem label="Transfer impact" active={view === "books"} onClick={() => props.onView("books")} />
        </div>

        <div className="nav-heading">Internal</div>
        <NavItem icon={ICON.internal} label="Matcher diagnostics" active={view === "diagnostics"} onClick={() => props.onView("diagnostics")} />
        <a className="nav-item" href="/design-system">
          <Icon d={ICON.components} />
          <span>Design system</span>
        </a>
      </nav>

      <div className="bottom">
        <div className="user">
          <span className="avatar">{user ? initials(user.name) : "?"}</span>
          <span className="who">
            <span className="name">{user?.name}</span>
            <span className="role">{user?.role}</span>
          </span>
        </div>
        <label>
          View as (demo)
          <select value={props.userId} onChange={(e) => props.onUser(e.target.value)}>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}, {u.role}
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
  // Total outstanding between businesses: each entity's net receivable, positives only.
  const owedBetween = books.entities.reduce((s, e) => {
    const net = e.dueFrom.reduce((x, d) => x + d.cents, 0) - e.dueTo.reduce((x, d) => x + d.cents, 0);
    return s + Math.max(0, net);
  }, 0);
  const draws = books.entities.reduce((s, e) => s + e.ownerDrawsCents - e.ownerContributionsCents, 0);
  const healthy =
    books.unbalancedEntries === 0 &&
    (books.intercompanyNetCents ?? 0) === 0 &&
    books.entities.every((e) => e.transfersInTransitCents === 0);
  return (
    <div className="summary">
      <div>
        <div className="k">Taken out of income</div>
        <div className="v">{moneyWhole(removed)}</div>
      </div>
      <div>
        <div className="k">Owed between your businesses</div>
        <div className="v">{moneyWhole(owedBetween)}</div>
      </div>
      <div>
        <div className="k">{draws >= 0 ? "Net owner's draws" : "Net owner contributions"}</div>
        <div className="v">{moneyWhole(Math.abs(draws))}</div>
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
                  <AmTierPill tier={p.tier} />
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
                  <AmStatusPill status={p.status} source={p.source} />
                </td>
                <td className="num" onClick={(e) => e.stopPropagation()}>
                  {p.status === "applied" && (
                    <AmButton variant="ghost" disabled={props.busy} onClick={() => props.onUndo(p)}>
                      Undo
                    </AmButton>
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

function Leg({ p, leg }: { p: ProposalView; leg: LegView }) {
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
      <div className="memo">
        <Memo p={p} leg={leg} />
      </div>
      <div className="booked">Booked as {leg.importCategory}</div>
    </div>
  );
}

export function Drawer(props: {
  p: ProposalView;
  userId: string;
  busy: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: (reason: string) => void;
  onUndo: () => void;
}) {
  const { p } = props;
  const [rejecting, setRejecting] = useState(false);
  const [checks, setChecks] = useState<{ id: string; label: string; ok: boolean; detail?: string }[] | null>(null);
  useEffect(() => setRejecting(false), [p.id]);
  // Pre-flight checks: the same ones the server re-runs inside the accept transaction.
  useEffect(() => {
    if (p.status !== "proposed") return setChecks(null);
    let cancelled = false;
    fetch(`/api/proposals/${p.id}/preflight`, { headers: { "x-user-id": props.userId } })
      .then((r) => r.json())
      .then((c) => !cancelled && setChecks(Array.isArray(c) ? c : null))
      .catch(() => !cancelled && setChecks(null));
    return () => {
      cancelled = true;
    };
  }, [p.id, p.version, p.status, props.userId]);
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
            {open && <AmTierPill tier={p.tier} long />}
            {!open && <AmStatusPill status={p.status} source={p.source} />}
            <AmKindPill kind={p.kind} />
            {p.source === "matcher" && <AmPill>Score {p.confidence.toFixed(2)}</AmPill>}
          </div>
        </div>
        <AmButton variant="ghost" className="close" onClick={props.onClose} aria-label="Close">
          ✕
        </AmButton>
      </div>

      <div className="drawer-body">
        <div>
          <h3>Bank activity</h3>
          <div className="legs">
            <div className="leg-group">
              {outs(p).map((l) => (
                <Leg key={l.transactionId} p={p} leg={l} />
              ))}
            </div>
            <div className="gap">{arrivalLabel(p)}</div>
            <div className="leg-group">
              {ins(p).map((l) => (
                <Leg key={l.transactionId} p={p} leg={l} />
              ))}
            </div>
          </div>
        </div>

        <div>
          <h3>Why this looks like a transfer</h3>
          <AmCheckList items={p.reasons.map((r) => ({ key: r, label: r, state: isAgainst(r) ? "fail" : "pass" }))} />
        </div>

        {open && checks && (
          <div>
            <h3>Checked before anything is posted</h3>
            <AmCheckList items={checks.map((c) => ({ key: c.id, label: c.label, state: c.ok ? "pass" : "fail", detail: c.detail }))} />
          </div>
        )}

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
            <AmButton disabled={props.busy} onClick={() => setRejecting(true)}>
              Not a transfer
            </AmButton>
            <span className="spacer" />
            <span className="legend" aria-hidden="true">
              <span className="kbd">J</span>
              <span className="kbd">K</span> move <span className="kbd">A</span> accept
            </span>
            <AmButton variant="primary" disabled={props.busy || (checks?.some((c) => !c.ok) ?? false)} onClick={props.onAccept}>
              Accept match
            </AmButton>
          </>
        )}
        {open && rejecting && (
          <div className="reasons-pick">
            <span>What&apos;s wrong with it?</span>
            <div className="row">
              {REJECT_REASONS.map((r) => (
                <AmButton key={r} disabled={props.busy} onClick={() => props.onReject(r)}>
                  {r}
                </AmButton>
              ))}
              <AmButton variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </AmButton>
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
              <AmButton disabled={props.busy} onClick={props.onUndo}>
                Undo
              </AmButton>
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
                <AmPill>{t.category}</AmPill>
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
      {books.entities.map((e) => {
        const owedBy = e.dueFrom.filter((d) => d.cents !== 0);
        const owedTo = e.dueTo.filter((d) => d.cents !== 0);
        return (
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
            {owedBy.map((d) => (
              <div className="line" key={`f-${d.otherEntityName}`}>
                <span className="l">Owed by {d.otherEntityName}</span>
                <span className="r">{moneyWhole(d.cents)}</span>
              </div>
            ))}
            {owedTo.map((d) => (
              <div className="line" key={`t-${d.otherEntityName}`}>
                <span className="l">Owed to {d.otherEntityName}</span>
                <span className="r">{moneyWhole(d.cents)}</span>
              </div>
            ))}
            {e.ownerDrawsCents !== 0 && (
              <div className="line">
                <span className="l">Owner&apos;s draws</span>
                <span className="r">{moneyWhole(e.ownerDrawsCents)}</span>
              </div>
            )}
            {e.ownerContributionsCents !== 0 && (
              <div className="line">
                <span className="l">Owner contributions</span>
                <span className="r">{moneyWhole(e.ownerContributionsCents)}</span>
              </div>
            )}
            {owedBy.length + owedTo.length === 0 && e.ownerDrawsCents === 0 && e.ownerContributionsCents === 0 && (
              <div className="line">
                <span className="l">Nothing owed between businesses yet</span>
                <span className="r" />
              </div>
            )}
          </section>
        );
      })}
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
        <div className="line">
          <span className="l">Owner&apos;s draws kept off the P&amp;L</span>
          <span className="r ok">✓</span>
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
      case "sale_confirmed":
        return `${who(a.actor)} confirmed ${money(d.amountCents)} from ${d.buyer} to ${d.seller} as a sale between the businesses`;
      case "sale_dismissed":
        return `${who(a.actor)} kept ${money(d.amountCents)} from ${d.buyer} to ${d.seller} as is`;
      case "sale_undecided":
        return `${who(a.actor)} reopened ${money(d.amountCents)} from ${d.buyer} to ${d.seller}`;
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

// ---------------------------------------------------------------------------
// Memo with the evidence highlighted
// ---------------------------------------------------------------------------

export function Memo({ p, leg }: { p: ProposalView; leg: LegView }) {
  const tokens = linkingTokens(p, leg);
  if (tokens.length === 0) return <>{leg.memo}</>;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = leg.memo.split(new RegExp(`(${escaped.join("|")})`, "i"));
  return (
    <>
      {parts.map((part, i) =>
        tokens.some((t) => t.toUpperCase() === part.toUpperCase()) ? (
          <mark key={i} title="Points at the other side of this match">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Paired view: a T-chart. Money out on the left, money in on the right,
// amounts meeting at the center line so they can be compared at a glance.
// ---------------------------------------------------------------------------

function TSide({ p, legs, side }: { p: ProposalView; legs: LegView[]; side: "out" | "in" }) {
  return (
    <div className={`t-side t-${side}`}>
      {legs.map((l) => {
        const short = side === "in" && p.feeCents > 0;
        return (
          <div className="t-leg" key={l.transactionId}>
            <div className="t-text">
              <div className="t-acct">
                {l.accountName} ...{l.last4}
              </div>
              <div className="t-memo">
                <Memo p={p} leg={l} />
              </div>
              <div className="t-meta">
                {shortDate(l.postedDate)}, {l.entityName}
              </div>
            </div>
            <div className={`t-amt ${short ? "short" : ""}`} title={short ? `${money(p.feeCents)} short` : undefined}>
              {side === "out" ? "−" : "+"}
              {money(Math.abs(l.amountCents))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PairedView(props: {
  proposals: ProposalView[];
  selected: number[];
  onSelect: (ids: number[]) => void;
  openId: number | null;
  onOpen: (id: number) => void;
}) {
  const { proposals, selected } = props;
  const toggle = (id: number) => props.onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="tchart">
      <div className="t-head">
        <div className="check">
          <SelectAll ids={proposals.map((p) => p.id)} selected={selected} onChange={props.onSelect} />
        </div>
        <div className="t-out">Money out</div>
        <div className="t-mid" />
        <div className="t-in">Money in</div>
      </div>
      {proposals.length === 0 && <div className="t-empty">Nothing to review here.</div>}
      {proposals.map((p) => {
        const gap = gapLabel(p);
        const slow = /^[3-9] /.test(gap);
        return (
          <div
            key={p.id}
            className={`t-row ${selected.includes(p.id) ? "is-selected" : ""} ${props.openId === p.id ? "is-open" : ""}`}
            onClick={() => props.onOpen(p.id)}
          >
            <div className="check" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" aria-label={`Select match ${p.id}`} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
            </div>
            <TSide p={p} legs={outs(p)} side="out" />
            <div className={`t-mid ${p.tier === "high" ? "strong" : "check"}`}>
              <span className={`t-gap ${slow ? "slow" : ""}`}>{gap}</span>
              <AmTierPill tier={p.tier} className="t-pill" />
            </div>
            <TSide p={p} legs={ins(p)} side="in" />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matcher diagnostics: every scripted case, graded against the answer key.
// Internal tool, read-only.
// ---------------------------------------------------------------------------

const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 } as const;

function CaseLegs({ legs }: { legs: CaseLeg[] }) {
  return (
    <div className="case-legs">
      {legs.map((l, i) => (
        <div key={i} className="case-leg">
          <span className={`amt ${l.amountCents > 0 ? "in" : ""}`}>
            {l.amountCents > 0 ? "+" : "−"}
            {money(Math.abs(l.amountCents))}
          </span>
          <span className="acct">
            {l.accountName} ...{l.last4}, {shortDate(l.postedDate)}
          </span>
          <span className="memo">{l.memo}</span>
        </div>
      ))}
    </div>
  );
}

const OUTCOME_PILL: Record<string, [AmPillTone, string]> = {
  strong: ["positive", "✓ Found, strong"],
  check: ["caution", "✓ Found, check"],
  missed: ["negative", "✗ Missed"],
  wrong: ["negative", "✗ Wrong pairing"],
  ignored: ["positive", "✓ Ignored"],
  proposed: ["negative", "✗ Proposed"],
};

export function DiagnosticsView({ data }: { data: Diagnostics | null }) {
  const [showOrdinary, setShowOrdinary] = useState(false);
  const [edgeOnly, setEdgeOnly] = useState(true);
  if (!data) return <div className="empty"><p>Running the matcher…</p></div>;
  const t = data.totals;
  const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);
  const sorted = [...data.transfers].sort((a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]);
  // Edge cases = anything not "easy", plus anything the matcher didn't nail.
  const transfers = edgeOnly ? sorted.filter((c) => c.difficulty !== "easy" || c.outcome !== "strong") : sorted;
  const traps = [...data.traps].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return (
    <>
      <p className="lede">
        Runs the matcher over the full synthetic bank feed ({t.transactions} transactions, both syncs) and grades it
        against the answer key. Read-only; it never touches the books. I wrote these scenarios and the scoring weights,
        so treat this as a regression check, not proof of real-world accuracy.
      </p>
      <div className="summary">
        <div>
          <div className="k">Real transfers found</div>
          <div className="v">
            {t.transfersFound} / {t.transfers}
          </div>
        </div>
        <div>
          <div className="k">Look-alikes ignored</div>
          <div className="v">
            {t.trapsIgnored} / {t.traps}
          </div>
        </div>
        <div>
          <div className="k">Ordinary activity left alone</div>
          <div className="v">
            {t.ordinaryLeftAlone} / {t.ordinary}
          </div>
        </div>
        <div>
          <div className="k">Precision: strong / check</div>
          <div className="v">
            {pct(t.strongCorrect, t.strongProposed)} / {pct(t.checkCorrect, t.checkProposed)}
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 24 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Real transfers
        </h2>
        <div className="segmented" role="group" aria-label="Which cases">
          <button aria-pressed={edgeOnly} onClick={() => setEdgeOnly(true)}>
            Edge cases {sorted.filter((c) => c.difficulty !== "easy" || c.outcome !== "strong").length}
          </button>
          <button aria-pressed={!edgeOnly} onClick={() => setEdgeOnly(false)}>
            All {sorted.length}
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="ledger cases">
          <thead>
            <tr>
              <th>Case</th>
              <th>Bank lines</th>
              <th>Type</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((c) => (
              <tr key={c.id}>
                <td className="case-name">
                  {c.label}
                  <span className="sub">
                    {c.id}, {c.difficulty}
                  </span>
                </td>
                <td>
                  <CaseLegs legs={c.legs} />
                </td>
                <td>
                  <AmPill>{KIND_LABEL[c.kind]}</AmPill>
                </td>
                <td>
                  <AmPill tone={OUTCOME_PILL[c.outcome][0]}>{OUTCOME_PILL[c.outcome][1]}</AmPill>
                  {c.score !== null && <span className="sub">Score {c.score.toFixed(2)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Look-alikes that are not transfers ({traps.length})</h2>
      <div className="table-wrap">
        <table className="ledger cases">
          <thead>
            <tr>
              <th>Case</th>
              <th>Bank lines</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {traps.map((c) => (
              <tr key={c.id}>
                <td className="case-name">
                  {c.label}
                  <span className="sub">{c.id}</span>
                </td>
                <td>
                  <CaseLegs legs={c.legs} />
                </td>
                <td>
                  <AmPill tone={OUTCOME_PILL[c.outcome][0]}>
                    {c.outcome === "proposed" ? `✗ Proposed as ${c.tier === "high" ? "strong" : "check"}` : OUTCOME_PILL.ignored[1]}
                  </AmPill>
                  {c.score !== null && <span className="sub">Score {c.score.toFixed(2)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Ordinary activity ({data.ordinary.length})</h2>
      <p className="lede">
        Feed bills, fuel, vet visits, cattle and hay sales, payroll, groceries on the personal account. None of it should be
        proposed. {t.ordinaryLeftAlone} of {t.ordinary} were left alone.
      </p>
      <AmButton onClick={() => setShowOrdinary(!showOrdinary)}>
        {showOrdinary ? "Hide" : "Show"} all {data.ordinary.length}
      </AmButton>
      {showOrdinary && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="ledger">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.ordinary.map((o, i) => (
                <tr key={i}>
                  <td className="date">{shortDate(o.postedDate)}</td>
                  <td>
                    {o.accountName} ...{o.last4}
                  </td>
                  <td>{o.memo}</td>
                  <td className="num">
                    {o.amountCents > 0 ? "+" : "−"}
                    {money(Math.abs(o.amountCents))}
                  </td>
                  <td>
                    <AmPill tone={o.proposed ? "negative" : "positive"}>{o.proposed ? "✗ Proposed" : "✓ Left alone"}</AmPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Consolidated statements: the businesses reported as one, for a lender
// ---------------------------------------------------------------------------

function StatementTable({ data, sections, totals }: { data: Consolidation; sections: Section[]; totals: ReportLine[] }) {
  const row = (l: ReportLine, cls = "") => (
    <tr key={`${cls}-${l.key}`} className={cls}>
      <td>{l.label}</td>
      {data.columns.map((c) => (
        <td className="num" key={c.id}>
          <AmMoney cents={l.byEntity[c.id]} format="accounting" />
        </td>
      ))}
      <td className={`num elim ${l.eliminationCents ? "has" : ""}`}><AmMoney cents={l.eliminationCents} format="accounting" /></td>
      <td className="num cons"><AmMoney cents={l.consolidatedCents} format="accounting" /></td>
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="ledger statement">
        <thead>
          <tr>
            <th />
            {data.columns.map((c) => (
              <th className="num" key={c.id}>
                {c.name}
              </th>
            ))}
            <th className="num">Eliminations</th>
            <th className="num">Consolidated</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => [
            <tr key={`h-${s.title}`} className="sec">
              <td colSpan={data.columns.length + 3}>{s.title}</td>
            </tr>,
            ...s.lines.map((l) => row(l)),
            row(s.total, "subtotal"),
          ])}
          {totals.map((t) => row(t, "total"))}
        </tbody>
      </table>
    </div>
  );
}

const READY_ACTION: Record<string, string> = {
  review: "Open review",
  unmatched: "See unmatched",
  sales: "Decide below",
};

export function ConsolidatedView(props: {
  data: Consolidation | null;
  allBusinesses: { id: string; name: string }[];
  chosen: string[] | null;
  onChoose: (ids: string[] | null) => void;
  busy: boolean;
  onDecide: (s: SaleCandidate, decision: "confirmed" | "dismissed" | "undecided") => void;
  onConfirmAll: (s: SaleCandidate[]) => void;
  onGo: (v: View) => void;
}) {
  const { data } = props;
  if (!data) return <p className="hint">Loading…</p>;
  const included = props.chosen ?? props.allBusinesses.map((b) => b.id);
  const toggle = (id: string) => {
    const next = included.includes(id) ? included.filter((x) => x !== id) : [...included, id];
    if (next.length === 0) return;
    props.onChoose(next.length === props.allBusinesses.length ? null : next);
  };
  const blocking = data.readiness.filter((c) => !c.ok && c.severity === "block");
  const pendingSales = data.sales.filter((s) => s.status === "pending");
  const go = (action?: string) => {
    if (action === "sales") document.getElementById("sales")?.scrollIntoView({ behavior: "smooth" });
    else if (action === "review" || action === "unmatched") props.onGo(action);
  };

  return (
    <div className="consolidated">
      <div className="toolbar">
        <span className="note">Include</span>
        <div className="chips" role="group" aria-label="Businesses to include">
          {props.allBusinesses.map((b) => (
            <button key={b.id} className="chip" aria-pressed={included.includes(b.id)} onClick={() => toggle(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
        <span className="note">{data.periodEnd ? `${shortDate("2026-07-01")} – ${shortDate(data.periodEnd)}, 2026` : ""}</span>
      </div>

      <section className={`readiness ${data.ready ? "is-ready" : ""}`} aria-live="polite">
        <h2>
          {data.ready
            ? "Ready to share with your lender"
            : `Not ready to share: ${blocking.length} ${blocking.length === 1 ? "thing" : "things"} to fix`}
        </h2>
        <AmCheckList
          items={data.readiness.map((c) => ({
            key: c.id,
            label: c.label,
            state: c.ok ? "pass" : c.severity === "block" ? "fail" : "warn",
            detail: c.detail,
            action: !c.ok && c.action && (
              <AmButton variant="link" size="small" onClick={() => go(c.action)}>
                {READY_ACTION[c.action]}
              </AmButton>
            ),
          }))}
        />
      </section>

      {data.columns.length > 1 && (
        <>
          <div className="section-head" id="sales">
            <div>
              <h2 className="section-title">Sales between your businesses</h2>
              <p className="lede">
                Real income for one business and a real expense for the other, so neither business&apos;s books change. They&apos;re removed
                only when the businesses are reported together.
              </p>
            </div>
            {pendingSales.length > 1 && (
              <AmButton disabled={props.busy} onClick={() => props.onConfirmAll(pendingSales)}>
                Confirm all {pendingSales.length}
              </AmButton>
            )}
          </div>
          <div className="table-wrap">
            <table className="ledger sales">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Paid by</th>
                  <th>Received by</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.sales.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={5}>No payments that look like sales between these businesses.</td>
                  </tr>
                )}
                {data.sales.map((s) => (
                  <tr key={s.key} className="static">
                    <td className="date">{shortDate(s.buyer.postedDate)}</td>
                    <td>
                      {s.buyer.entityName}
                      <span className="sub">
                        {s.buyer.memo} · {s.buyer.category}
                      </span>
                    </td>
                    <td>
                      {s.seller.entityName}
                      <span className="sub">
                        {s.seller.memo} · {s.seller.category}
                      </span>
                    </td>
                    <td className="num">{money(s.seller.amountCents)}</td>
                    <td className="num">
                      <div className="actions">
                        {s.status === "pending" ? (
                          <>
                            <AmButton variant="ghost" disabled={props.busy} onClick={() => props.onDecide(s, "dismissed")}>
                              Not between us
                            </AmButton>
                            <AmButton disabled={props.busy} onClick={() => props.onDecide(s, "confirmed")}>
                              Confirm
                            </AmButton>
                          </>
                        ) : (
                          <>
                            <AmPill tone={s.status === "confirmed" ? "positive" : "neutral"}>
                              {s.status === "confirmed" ? "Eliminated" : "Kept as is"}
                            </AmPill>
                            <AmButton variant="link" disabled={props.busy} onClick={() => props.onDecide(s, "undecided")}>
                              Undo
                            </AmButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section-title">Income statement</h2>
      <StatementTable data={data} sections={[data.income, data.expenses]} totals={[data.netIncome]} />

      <h2 className="section-title">Balance sheet</h2>
      <StatementTable data={data} sections={[data.assets, data.liabilities, data.equity]} totals={[data.liabilitiesAndEquity]} />

      {data.eliminations.length > 0 && (
        <>
          <h2 className="section-title">What was eliminated, and why</h2>
          <ul className="activity eliminations">
            {data.eliminations.map((e, i) => (
              <li key={i}>
                <span>
                  <b>{e.title}</b>
                  <span className="sub">{e.detail}</span>
                </span>
                <span className="amt">{money(e.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">
        Eliminations exist only in this report. Nothing is posted to any business&apos;s books, and each still files taxes on its own
        numbers.
        {data.columns.length < props.allBusinesses.length &&
          " Amounts owed by a business you left out stay on the balance sheet: to this group, that business is an outside party."}
      </p>
    </div>
  );
}
