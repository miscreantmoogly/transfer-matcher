"use client";

import { useState } from "react";
import {
  gapLabel,
  isAgainst,
  matchTitle,
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

// ---------------------------------------------------------------------------
// A match: withdrawal stub(s) on the left, deposit stub(s) on the right,
// joined by a bracket that says how far apart they posted.
// ---------------------------------------------------------------------------

function Stub({ leg }: { leg: LegView }) {
  const out = leg.direction === "out";
  return (
    <div className="stub">
      <div className="acct">
        <b>{leg.accountName}</b>
        <span>...{leg.last4}</span>
        <span>{shortDate(leg.postedDate)}</span>
      </div>
      <div className={`amount ${out ? "out" : "in"}`}>
        {out ? "−" : "+"}
        {money(Math.abs(leg.amountCents))}
      </div>
      <div className="memo">{leg.memo}</div>
      <div className="booked">Currently booked as {leg.importCategory}</div>
    </div>
  );
}

const REJECT_REASONS = ["Not the same money", "One side is a real purchase or sale", "Wrong pairing"];

export function MatchCard(props: {
  p: ProposalView;
  busy: boolean;
  /** Strong matches start collapsed so a long list is quick to skim. */
  compact?: boolean;
  onAccept?: () => void;
  onReject?: (reason: string) => void;
  onUndo?: () => void;
}) {
  const { p, busy } = props;
  const [rejecting, setRejecting] = useState(false);
  const [open, setOpen] = useState(!props.compact);
  const decided = p.status !== "proposed";
  const outs = p.legs.filter((l) => l.direction === "out");
  const ins = p.legs.filter((l) => l.direction === "in");
  const reasons = p.reasons;
  const effects = plainEffects(p);

  return (
    <article className={`match ${decided ? "decided" : `tier-${p.tier}`}`} aria-label={`Match ${p.id}`}>
      <div className="match-top">
        <span className="match-title">
          {money(p.totalCents)} from {matchTitle(p)}
        </span>
        {p.kind === "intercompany" && <span className="pill intercompany">Between your businesses</span>}
        {!decided && p.tier === "high" && <span className="pill high">Ready to accept</span>}
        {!decided && p.tier === "review" && <span className="pill review">Worth a look</span>}
        {p.source === "manual" && <span className="pill neutral">Matched by hand</span>}
        {decided && <span className={`pill ${p.status}`}>{statusLabel(p.status)}</span>}
        <span className="score" title="Match score from 0 to 1. A ranking signal, not a probability.">
          {p.source === "matcher" ? `Score ${p.confidence.toFixed(2)}` : ""}
          {p.source === "matcher" && p.tier === "review" && p.confidence >= 0.75 && ". Fees and splits always get a person's look"}
        </span>
      </div>

      <div className="pair">
        <div className="side">
          {outs.map((l) => (
            <Stub key={l.transactionId} leg={l} />
          ))}
        </div>
        <div className={`bracket ${p.kind}`} aria-hidden="true">
          <span className="gap">{gapLabel(p)}</span>
        </div>
        <div className="side">
          {ins.map((l) => (
            <Stub key={l.transactionId} leg={l} />
          ))}
        </div>
      </div>

      {open && (
      <div className="details">
        <div>
          <h4>Why we think these are one transfer</h4>
          <ul>
            {reasons.map((r) => (
              <li key={r} className={isAgainst(r) ? "against" : ""}>
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>{decided ? "What this did to your books" : "If you accept"}</h4>
          <ul>
            {effects.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </div>
      )}

      <div className="match-actions">
        {!decided && !rejecting && (
          <>
            <span className="grow">Nothing changes until you accept. You can undo it later.</span>
            {props.compact && (
              <button className="btn quiet small" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? "Hide details" : "Why, and what changes"}
              </button>
            )}
            <button className="btn danger" disabled={busy} onClick={() => setRejecting(true)}>
              Not a transfer
            </button>
            <button className="btn primary" disabled={busy} onClick={props.onAccept}>
              Accept match
            </button>
          </>
        )}
        {!decided && rejecting && (
          <div className="reject-reasons">
            <span>What&apos;s wrong with it?</span>
            {REJECT_REASONS.map((r) => (
              <button key={r} className="btn small" disabled={busy} onClick={() => props.onReject?.(r)}>
                {r}
              </button>
            ))}
            <button className="btn quiet small" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        )}
        {decided && (
          <>
            <span className="grow">
              {statusLabel(p.status)} {p.decidedAt ? timeAgo(p.decidedAt) : ""}
              {p.status === "rejected" && " · won't be suggested again"}
              {p.status === "reversed" && " · reversing entries posted, originals kept for the audit trail"}
            </span>
            {props.compact && (
              <button className="btn quiet small" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? "Hide details" : "Details"}
              </button>
            )}
            {p.status === "applied" && (
              <button className="btn small" disabled={busy} onClick={props.onUndo}>
                Undo
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function statusLabel(status: string) {
  return { applied: "Accepted", rejected: "Marked not a transfer", reversed: "Undone", superseded: "Replaced" }[status] ?? status;
}

// ---------------------------------------------------------------------------
// Unmatched transactions, with manual matching for what the matcher missed.
// ---------------------------------------------------------------------------

export function UnmatchedTable(props: {
  txns: UnmatchedTxn[];
  busy: boolean;
  onMatch: (ids: number[]) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [likelyOnly, setLikelyOnly] = useState(true);
  // "Could be a transfer" = the import couldn't recognize it as a purchase or
  // sale. Feed bills and cattle sales are hidden so the haystack is small.
  const likely = (t: UnmatchedTxn) => t.category.startsWith("Uncategorized");
  const shown = props.txns.filter((t) => !likelyOnly || likely(t) || selected.includes(t.id));
  const chosen = props.txns.filter((t) => selected.includes(t.id));
  const out = -chosen.filter((t) => t.amountCents < 0).reduce((s, t) => s + t.amountCents, 0);
  const inn = chosen.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <div className="filters">
        <label>
          <input type="checkbox" checked={likelyOnly} onChange={(e) => setLikelyOnly(e.target.checked)} /> Only show
          lines that could be transfers
        </label>
        <span>
          {shown.length} of {props.txns.length}
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>
              <span className="visually-hidden">Select</span>
            </th>
            <th>Date</th>
            <th>Account</th>
            <th>Bank memo</th>
            <th style={{ textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.id} className={selected.includes(t.id) ? "selected" : ""}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${t.memo}`}
                  checked={selected.includes(t.id)}
                  onChange={() => toggle(t.id)}
                />
              </td>
              <td style={{ whiteSpace: "nowrap" }}>{shortDate(t.postedDate)}</td>
              <td>
                {t.accountName} <span className="sub">{t.entityName}</span>
              </td>
              <td className="memo">
                {t.memo}
                <span className="sub">
                  Booked as {t.category}
                  {t.awaitingCounterpart && ". The other side may not have arrived yet"}
                </span>
              </td>
              <td className="num">{money(t.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected.length > 0 && (
        <div className="selectionbar" role="region" aria-label="Selected transactions">
          <span className="grow">
            {selected.length} selected: {money(out)} out, {money(inn)} in
            {out > 0 && inn > 0 && out !== inn && `, off by ${money(out - inn)}`}
          </span>
          <button className="btn quiet small" style={{ color: "#fff" }} onClick={() => setSelected([])}>
            Clear
          </button>
          <button
            className="btn small"
            disabled={props.busy || out === 0 || inn === 0}
            onClick={() => {
              props.onMatch(selected);
              setSelected([]);
            }}
          >
            Match as one transfer
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The books: what the owner actually cares about.
// ---------------------------------------------------------------------------

export function BooksPanel({ books }: { books: BooksSummary }) {
  return (
    <section className="panel" aria-labelledby="books-h">
      <h2 id="books-h">Your books</h2>
      <p className="lede">Income as the bank import booked it, and after the transfers you&apos;ve matched.</p>
      {books.entities.map((e) => {
        const removed = e.incomeBeforeCents - e.incomeNowCents;
        const owed = e.dueFrom.filter((d) => d.cents !== 0);
        const owes = e.dueTo.filter((d) => d.cents !== 0);
        return (
          <div className="entity" key={e.entityId}>
            <h3>{e.entityName}</h3>
            <div className="row">
              <span className="label">Income</span>
              <span className="val">
                {removed !== 0 && <span className="was">{moneyWhole(e.incomeBeforeCents)}</span>}
                {moneyWhole(e.incomeNowCents)}
              </span>
            </div>
            <div className="row">
              <span className="label">Expenses</span>
              <span className="val">
                {e.expenseBeforeCents !== e.expenseNowCents && <span className="was">{moneyWhole(e.expenseBeforeCents)}</span>}
                {moneyWhole(e.expenseNowCents)}
              </span>
            </div>
            {owed.map((d) => (
              <div className="row" key={`from-${d.otherEntityName}`}>
                <span className="label">Owed by {d.otherEntityName}</span>
                <span className="val">{moneyWhole(d.cents)}</span>
              </div>
            ))}
            {owes.map((d) => (
              <div className="row" key={`to-${d.otherEntityName}`}>
                <span className="label">Owes {d.otherEntityName}</span>
                <span className="val">{moneyWhole(d.cents)}</span>
              </div>
            ))}
            {removed > 0 && (
              <div className="delta">{moneyWhole(removed)} that was just your own money moving is no longer counted as income.</div>
            )}
          </div>
        );
      })}
      <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "12px 0 6px" }}>Checks</h3>
      <ul className="checks">
        <li>
          <span className={books.unbalancedEntries === 0 ? "ok" : "bad"}>{books.unbalancedEntries === 0 ? "✓" : "✗"}</span>
          Every entry balances (debits = credits)
        </li>
        {books.intercompanyNetCents !== null && (
          <li>
            <span className={books.intercompanyNetCents === 0 ? "ok" : "bad"}>{books.intercompanyNetCents === 0 ? "✓" : "✗"}</span>
            What your businesses owe each other nets to {money(books.intercompanyNetCents)}
          </li>
        )}
        <li>
          <span className={books.entities.every((e) => e.transfersInTransitCents === 0) ? "ok" : "bad"}>
            {books.entities.every((e) => e.transfersInTransitCents === 0) ? "✓" : "✗"}
          </span>
          No money stuck &quot;in transit&quot;
        </li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Activity: the audit log, in sentences.
// ---------------------------------------------------------------------------

export function Activity({ audit, users }: { audit: AppState["audit"]; users: AppState["users"] }) {
  const who = (actor: string) =>
    actor.startsWith("system") ? "The matcher" : (users.find((u) => u.id === actor)?.name.split(" ")[0] ?? actor);
  const describe = (a: AppState["audit"][number]) => {
    const d = a.details ? JSON.parse(a.details) : {};
    switch (a.action) {
      case "bank_sync":
        return <><b>{who(a.actor)}</b> synced the bank: {d.inserted} new transactions</>;
      case "match_run":
        return <><b>{who(a.actor)}</b> found {d.created} new match{d.created === 1 ? "" : "es"}{d.superseded ? `, replaced ${d.superseded}` : ""}</>;
      case "accept":
        return <><b>{who(a.actor)}</b> accepted match #{a.proposal_id}</>;
      case "reject":
        return <><b>{who(a.actor)}</b> marked #{a.proposal_id} not a transfer: {d.reason}</>;
      case "undo":
        return <><b>{who(a.actor)}</b> undid match #{a.proposal_id}</>;
      case "manual_match":
        return <><b>{who(a.actor)}</b> matched #{a.proposal_id} by hand</>;
      default:
        return <><b>{who(a.actor)}</b> {a.action}</>;
    }
  };
  return (
    <section className="panel" aria-labelledby="activity-h">
      <h2 id="activity-h">Activity</h2>
      {audit.length === 0 ? (
        <p className="lede">Nothing yet.</p>
      ) : (
        <ul className="activity">
          {groupAccepts(audit.filter(isNews)).slice(0, 10).map((a) => (
            <li key={a.id}>
              {a.count > 1 ? (
                <>
                  <b>{who(a.actor)}</b> accepted {a.count} matches
                </>
              ) : (
                describe(a)
              )}{" "}
              <span className="when">{timeAgo(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A matcher run that changed nothing isn't worth a line. */
function isNews(a: AppState["audit"][number]) {
  if (a.action !== "match_run" || !a.details) return true;
  const d = JSON.parse(a.details);
  return d.created > 0 || d.superseded > 0;
}

/** "Accept all 20" writes 20 audit rows; show them as one line. */
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
// Demo walkthrough: the order to show things in. Collapsible.
// ---------------------------------------------------------------------------

export function Guide({ state, open, onToggle }: { state: AppState; open: boolean; onToggle: () => void }) {
  const s = state;
  const steps: [string, boolean][] = [
    ["Sync the bank to pull in July–September", s.counts.bankTransactions > 0],
    ["Accept the matches marked ready", s.counts.applied > 0 && !s.proposals.some((p) => p.tier === "high")],
    ["Work through the ones worth a look (one of them isn't a transfer)", s.counts.applied > 0 && !s.proposals.some((p) => p.tier === "review")],
    ["In Unmatched, pair the $2,350 paper check with its deposit by hand", s.decided.some((p) => p.source === "manual")],
    ["Undo a match, then watch the books go back", s.decided.some((p) => p.status === "reversed")],
    ["Sync again: a late deposit arrives and gets matched", (s.counts.latestPostedDate ?? "") > "2026-09-25"],
    ["Switch to Dana, who only keeps Hollis Ranch's books", s.user.id === "dana"],
  ];
  const current = steps.findIndex(([, done]) => !done);
  return (
    <section className="guide" aria-labelledby="guide-h">
      <div className="guide-head">
        <h2 id="guide-h">Demo walkthrough</h2>
        <button className="btn quiet small" onClick={onToggle} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <ol>
          {steps.map(([label, done], i) => (
            <li key={label} className={done ? "done" : i === current ? "current" : ""}>
              {label}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
