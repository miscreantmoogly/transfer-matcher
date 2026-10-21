"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BooksView,
  Drawer,
  HistoryTable,
  ReviewTable,
  Sidebar,
  Summary,
  UnmatchedTable,
  type View,
} from "./components";
import { money, type AppState, type ProposalView } from "./lib";

type Filter = "all" | "high" | "review";

export default function Page() {
  const [userId, setUserId] = useState("wes");
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("review");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedTxns, setSelectedTxns] = useState<number[]>([]);
  const [likelyOnly, setLikelyOnly] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;

  // ---- Data ------------------------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { headers: { "x-user-id": userRef.current }, cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setState(body);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500); // picks up the worker's results
    return () => clearInterval(t);
  }, [refresh, userId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // An emptied filter (e.g. after accepting every strong match) falls back to All.
  useEffect(() => {
    if (!state || filter === "all") return;
    if (!state.proposals.some((p) => p.tier === filter)) setFilter("all");
  }, [state, filter]);

  // Drop selections that no longer exist (accepted, superseded, matched...).
  useEffect(() => {
    if (!state) return;
    const live = new Set(state.proposals.map((p) => p.id));
    setSelected((s) => (s.every((id) => live.has(id)) ? s : s.filter((id) => live.has(id))));
    const liveTxns = new Set(state.unmatched.map((t) => t.id));
    setSelectedTxns((s) => (s.every((id) => liveTxns.has(id)) ? s : s.filter((id) => liveTxns.has(id))));
  }, [state]);

  async function call(path: string, body: unknown, success: (result: any) => string) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": userId },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? res.statusText);
      setToast({ text: success(result) });
      return result;
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (!state) {
    return (
      <main>
        <div className="empty">
          <h2>{loadError ? "Can't reach the database" : "Loading…"}</h2>
          {loadError && <p>{loadError}</p>}
        </div>
      </main>
    );
  }

  // ---- Derived ------------------------------------------------------------------
  const hasData = state.counts.bankTransactions > 0;
  const strong = state.proposals.filter((p) => p.tier === "high");
  const check = state.proposals.filter((p) => p.tier === "review");
  const shown = filter === "high" ? strong : filter === "review" ? check : state.proposals;
  const latest = state.counts.latestPostedDate;
  const nextBatch = !hasData ? 1 : latest && latest <= "2026-09-25" ? 2 : null;
  const pendingJob = state.jobs.recent.find((j) => j.status === "queued" || j.status === "running");
  const workerDown = pendingJob?.status === "queued" && Date.now() - new Date(pendingJob.run_after).getTime() > 6000;
  const open: ProposalView | undefined =
    openId === null ? undefined : [...state.proposals, ...state.decided].find((p) => p.id === openId);
  // "Could be a transfer" = the import couldn't recognize it as a purchase or sale.
  const unmatched = likelyOnly ? state.unmatched.filter((t) => t.category.startsWith("Uncategorized")) : state.unmatched;
  const chosenTxns = state.unmatched.filter((t) => selectedTxns.includes(t.id));
  const txOut = -chosenTxns.filter((t) => t.amountCents < 0).reduce((s, t) => s + t.amountCents, 0);
  const txIn = chosenTxns.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);

  const items = (ids: number[]) =>
    state.proposals.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, version: p.version }));
  const bulkMessage = (verb: string) => (r: { ok: boolean }[]) => {
    const ok = r.filter((x) => x.ok).length;
    return ok === r.length ? `${verb} ${ok} match${ok === 1 ? "" : "es"}.` : `${verb} ${ok} of ${r.length}. The rest changed; check them again.`;
  };

  const sync = () =>
    call("/api/sync", { batch: nextBatch }, (r) =>
      r.inserted ? `Pulled in ${r.inserted} new transactions.` : "No new transactions.",
    );

  const titles: Record<View, string> = {
    review: "Review transfers",
    unmatched: "Unmatched transactions",
    books: "Books",
    history: "History",
  };

  return (
    <div className="shell">
      <Sidebar
        state={state}
        view={view}
        onView={(v) => {
          setView(v);
          setOpenId(null);
        }}
        userId={userId}
        onUser={(id) => {
          setUserId(id);
          setSelected([]);
          setSelectedTxns([]);
          setOpenId(null);
          setState(null);
        }}
        onReset={() => {
          setOpenId(null);
          call("/api/reset", {}, () => "Demo data reset.");
        }}
      />

      <main>
        <div className="page-head">
          <h1>{titles[view]}</h1>
          {pendingJob && !workerDown && (
            <span className="status" role="status">
              <span className="dot" aria-hidden="true" />
              Matching new activity…
            </span>
          )}
          {workerDown && (
            <span className="status warn" role="status">
              Matcher isn&apos;t running.
              <button className="btn link" disabled={busy} onClick={() => call("/api/match/run", {}, (r) => `Found ${r.created} new matches.`)}>
                Run now
              </button>
            </span>
          )}
          <span className="spacer" />
          {hasData && (
            <button className="btn primary" disabled={busy || nextBatch === null} onClick={sync}>
              {nextBatch === null ? "Bank is up to date" : "Sync bank"}
            </button>
          )}
        </div>

        {!hasData ? (
          <div className="empty">
            <h2>No bank activity yet</h2>
            <p>Sync your banks to bring in recent transactions. Transfers between your own accounts and businesses will show up here for review.</p>
            <button className="btn primary" disabled={busy} onClick={sync}>
              Sync bank
            </button>
          </div>
        ) : (
          <>
            {view === "review" && (
              <>
                <Summary books={state.books} />
                <div className="toolbar">
                  <div className="segmented" role="group" aria-label="Filter matches">
                    {(
                      [
                        ["all", `All ${state.proposals.length}`],
                        ["high", `Strong ${strong.length}`],
                        ["review", `Check ${check.length}`],
                      ] as [Filter, string][]
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={filter === id}
                        onClick={() => {
                          setFilter(id);
                          setSelected([]);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <ReviewTable proposals={shown} selected={selected} onSelect={setSelected} openId={openId} onOpen={setOpenId} />
                {state.hiddenProposals > 0 && (
                  <p className="hint">
                    {state.hiddenProposals} more involve a business you don&apos;t have access to.
                  </p>
                )}
              </>
            )}

            {view === "unmatched" && (
              <>
                <div className="toolbar">
                  <div className="segmented" role="group" aria-label="Filter transactions">
                    <button aria-pressed={likelyOnly} onClick={() => setLikelyOnly(true)}>
                      Uncategorized {state.unmatched.filter((t) => t.category.startsWith("Uncategorized")).length}
                    </button>
                    <button aria-pressed={!likelyOnly} onClick={() => setLikelyOnly(false)}>
                      All {state.unmatched.length}
                    </button>
                  </div>
                  <span className="note">Select both sides of a transfer the matcher missed.</span>
                </div>
                <UnmatchedTable txns={unmatched} selected={selectedTxns} onSelect={setSelectedTxns} />
              </>
            )}

            {view === "books" && <BooksView books={state.books} />}

            {view === "history" && (
              <>
                <HistoryTable
                  decided={state.decided}
                  users={state.users}
                  openId={openId}
                  onOpen={setOpenId}
                  busy={busy}
                  onUndo={(p) => call(`/api/proposals/${p.id}/undo`, { version: p.version }, () => "Undone. Reversing entries posted.")}
                />
                <h2 className="section-title">Activity</h2>
                <Activity audit={state.audit} users={state.users} />
              </>
            )}
          </>
        )}
      </main>

      {view === "review" && selected.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <span className="count">{selected.length} selected</span>
          <button className="btn" disabled={busy} onClick={() => setSelected([])}>
            Clear
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              call("/api/proposals/bulk-reject", { items: items(selected), reason: "Not a transfer" }, bulkMessage("Rejected")).then(() =>
                setSelected([]),
              )
            }
          >
            Not transfers
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => call("/api/proposals/bulk-accept", { items: items(selected) }, bulkMessage("Accepted")).then(() => setSelected([]))}
          >
            Accept {selected.length}
          </button>
        </div>
      )}

      {view === "unmatched" && selectedTxns.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Selected transactions">
          <span className="count">
            {money(txOut)} out, {money(txIn)} in
          </span>
          <button className="btn" disabled={busy} onClick={() => setSelectedTxns([])}>
            Clear
          </button>
          <button
            className="btn primary"
            disabled={busy || txOut === 0 || txIn === 0}
            onClick={() =>
              call("/api/matches/manual", { transactionIds: selectedTxns }, () => "Matched. Your books are updated.").then(() =>
                setSelectedTxns([]),
              )
            }
          >
            Match as transfer
          </button>
        </div>
      )}

      {open && (
        <Drawer
          p={open}
          busy={busy}
          onClose={() => setOpenId(null)}
          onAccept={() => call(`/api/proposals/${open.id}/accept`, { version: open.version }, () => "Accepted.").then(() => setOpenId(null))}
          onReject={(reason) =>
            call(`/api/proposals/${open.id}/reject`, { version: open.version, reason }, () => "Marked not a transfer.").then(() => setOpenId(null))
          }
          onUndo={() => call(`/api/proposals/${open.id}/undo`, { version: open.version }, () => "Undone. Reversing entries posted.")}
        />
      )}

      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
