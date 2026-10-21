"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BooksView,
  ConsolidatedView,
  DiagnosticsView,
  Drawer,
  HistoryTable,
  PairedView,
  ReviewTable,
  Sidebar,
  Summary,
  UnmatchedTable,
  type View,
} from "./components";
import { money, type AppState, type ProposalView } from "./lib";
import { AmButton } from "@/design-system";
import type { Diagnostics } from "@/lib/diagnostics";
import type { Consolidation, SaleCandidate } from "@/lib/services/consolidation";

type Filter = "all" | "high" | "review";
type Layout = "paired" | "list";
type Toast = { text: string; error?: boolean; action?: { label: string; run: () => void } };

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
  const [toast, setToast] = useState<Toast | null>(null);
  const [layout, setLayout] = useState<Layout>("paired");
  const userRef = useRef(userId);
  userRef.current = userId;
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  const [consolidation, setConsolidation] = useState<Consolidation | null>(null);
  const [consEntities, setConsEntities] = useState<string[] | null>(null); // null = every business
  // Re-fetch the report whenever something that changes it happens (any new audit row).
  const lastEvent = state?.audit[0]?.id ?? 0;
  const txnCount = state?.counts.bankTransactions ?? 0;
  useEffect(() => {
    if (view !== "consolidated") return;
    const q = consEntities ? `?entities=${consEntities.join(",")}` : "";
    fetch(`/api/consolidation${q}`, { headers: { "x-user-id": userRef.current }, cache: "no-store" })
      .then((r) => r.json())
      .then((body) => setConsolidation(body.error ? null : body))
      .catch(() => setConsolidation(null));
  }, [view, consEntities, lastEvent, txnCount, userId]);

  // Diagnostics are computed on demand, only when the internal page is open.
  useEffect(() => {
    if (view !== "diagnostics") return;
    fetch("/api/diagnostics", { headers: { "x-user-id": userRef.current } })
      .then((r) => r.json())
      .then(setDiagnostics)
      .catch(() => setDiagnostics(null));
  }, [view]);

  // Remember the list/paired choice for this viewer (a convenience, so storage failures are ignored).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tm.layout");
      if (saved === "list" || saved === "paired") setLayout(saved);
    } catch {}
  }, []);
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem("tm.layout", l);
    } catch {}
  };

  // Keyboard: J/K or arrows move through the queue, A accepts, X selects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    const t = setTimeout(() => setToast(null), toast.action ? 7000 : 4000);
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

  async function call(path: string, body: unknown, success: (result: any) => string | Toast) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": userId },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? res.statusText);
      const message = success(result);
      setToast(typeof message === "string" ? { text: message } : message);
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
  // "Could be a transfer" = on a business's books, and the import couldn't recognize it as a purchase or sale.
  const likely = state.unmatched.filter((t) => t.entityKind === "business" && t.category.startsWith("Uncategorized"));
  const unmatched = likelyOnly ? likely : state.unmatched;
  const chosenTxns = state.unmatched.filter((t) => selectedTxns.includes(t.id));
  const txOut = -chosenTxns.filter((t) => t.amountCents < 0).reduce((s, t) => s + t.amountCents, 0);
  const txIn = chosenTxns.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);

  const items = (ids: number[]) =>
    state.proposals.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, version: p.version }));
  const bulkMessage = (verb: string) => (r: { ok: boolean }[]) => {
    const ok = r.filter((x) => x.ok).length;
    return ok === r.length ? `${verb} ${ok} match${ok === 1 ? "" : "es"}.` : `${verb} ${ok} of ${r.length}. The rest changed; check them again.`;
  };

  // Accept / reject from the drawer, then move straight to the next match:
  // reviewing is working through a list, not opening and closing items.
  const neighbourOf = (id: number) => {
    const i = shown.findIndex((p) => p.id === id);
    return (shown[i + 1] ?? shown[i - 1])?.id ?? null;
  };
  const accept = (p: ProposalView) => {
    const next = neighbourOf(p.id);
    return call(`/api/proposals/${p.id}/accept`, { version: p.version }, (applied: ProposalView) => ({
      text: `Accepted ${money(p.totalCents)}.`,
      action: {
        label: "Undo",
        run: () => call(`/api/proposals/${applied.id}/undo`, { version: applied.version }, () => "Undone. Reversing entries posted."),
      },
    })).then((r) => r && setOpenId(next));
  };
  const reject = (p: ProposalView, reason: string) => {
    const next = neighbourOf(p.id);
    return call(`/api/proposals/${p.id}/reject`, { version: p.version, reason }, () => "Marked not a transfer.").then(
      (r) => r && setOpenId(next),
    );
  };

  const saleBody = (s: SaleCandidate, decision: string) => ({
    buyerTxnId: s.buyer.transactionId,
    sellerTxnId: s.seller.transactionId,
    decision,
  });
  const decideSale = (s: SaleCandidate, decision: "confirmed" | "dismissed" | "undecided") =>
    call("/api/consolidation/sales", saleBody(s, decision), () =>
      decision === "confirmed"
        ? { text: `Eliminated ${money(s.seller.amountCents)} from the combined report.`, action: { label: "Undo", run: () => decideSale(s, "undecided") } }
        : decision === "dismissed"
          ? "Kept as is."
          : "Reopened.",
    );
  const confirmAllSales = (sales: SaleCandidate[]) =>
    call(
      "/api/consolidation/sales",
      { decision: "confirmed", items: sales.map((s) => ({ buyerTxnId: s.buyer.transactionId, sellerTxnId: s.seller.transactionId })) },
      (r: { ok: boolean }[]) => {
        const ok = r.filter((x) => x.ok).length;
        return ok === r.length
          ? `Eliminated ${ok} sales, ${money(sales.reduce((t, s) => t + s.seller.amountCents, 0))}, from the combined report.`
          : `Confirmed ${ok} of ${r.length}. The rest changed; check them again.`;
      },
    );

  keyHandler.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (view !== "review" || busy || e.metaKey || e.ctrlKey || e.altKey) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) && (target as HTMLInputElement).type !== "checkbox") return;
    const i = shown.findIndex((p) => p.id === openId);
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setOpenId(shown[Math.min(i + 1, shown.length - 1)]?.id ?? null);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpenId(shown[Math.max(i - 1, 0)]?.id ?? null);
    } else if (e.key === "a" && open && open.status === "proposed") {
      accept(open);
    } else if (e.key === "x" && open) {
      setSelected((s) => (s.includes(open.id) ? s.filter((x) => x !== open.id) : [...s, open.id]));
    }
  };

  const sync = () =>
    call("/api/sync", { batch: nextBatch }, (r) =>
      r.inserted ? `Pulled in ${r.inserted} new transactions.` : "No new transactions.",
    );

  const titles: Record<View, [string, string]> = {
    review: ["Transfers", "Review"],
    unmatched: ["Transfers", "Unmatched transactions"],
    history: ["Transfers", "History"],
    books: ["Reports", "Transfer impact"],
    consolidated: ["Reports", "Consolidated statements"],
    diagnostics: ["Internal", "Matcher diagnostics"],
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

      <main className={open ? "with-drawer" : ""}>
        <div className="page-head">
          <div>
            <div className="crumbs">{titles[view][0]}</div>
            <h1>
              {titles[view][1]}
              {view === "diagnostics" && <span className="tag">Internal</span>}
            </h1>
          </div>
          {pendingJob && !workerDown && (
            <span className="status" role="status">
              <span className="dot" aria-hidden="true" />
              Matching new activity…
            </span>
          )}
          {workerDown && (
            <span className="status warn" role="status">
              Matcher isn&apos;t running.
              <AmButton variant="link" disabled={busy} onClick={() => call("/api/match/run", {}, (r) => `Found ${r.created} new matches.`)}>
                Run now
              </AmButton>
            </span>
          )}
          <span className="spacer" />
          {hasData && view !== "diagnostics" && (
            <AmButton variant="primary" disabled={busy || nextBatch === null} onClick={sync}>
              {nextBatch === null ? "Bank is up to date" : "Sync bank"}
            </AmButton>
          )}
        </div>

        {!hasData && view !== "diagnostics" ? (
          <div className="empty">
            <h2>No bank activity yet</h2>
            <p>Sync your banks to bring in recent transactions. Transfers between your own accounts and businesses will show up here for review.</p>
            <AmButton variant="primary" disabled={busy} onClick={sync}>
              Sync bank
            </AmButton>
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
                  {layout === "paired" && (
                    <span className="legend">
                      <mark>Highlighted</mark> text points at the other side
                    </span>
                  )}
                  <div className="segmented view-toggle" role="group" aria-label="Layout">
                    <button aria-pressed={layout === "paired"} onClick={() => chooseLayout("paired")}>
                      Paired
                    </button>
                    <button aria-pressed={layout === "list"} onClick={() => chooseLayout("list")}>
                      List
                    </button>
                  </div>
                </div>
                {layout === "paired" ? (
                  <PairedView proposals={shown} selected={selected} onSelect={setSelected} openId={openId} onOpen={setOpenId} />
                ) : (
                  <ReviewTable proposals={shown} selected={selected} onSelect={setSelected} openId={openId} onOpen={setOpenId} />
                )}
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
                      Could be transfers {likely.length}
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
            {view === "consolidated" && (
              <ConsolidatedView
                data={consolidation}
                allBusinesses={state.entities.filter((e) => e.kind === "business")}
                chosen={consEntities}
                onChoose={(ids) => {
                  setConsolidation(null);
                  setConsEntities(ids);
                }}
                busy={busy}
                onDecide={decideSale}
                onConfirmAll={confirmAllSales}
                onGo={setView}
              />
            )}
            {view === "diagnostics" && <DiagnosticsView data={diagnostics} />}

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
          <AmButton onDark disabled={busy} onClick={() => setSelected([])}>
            Clear
          </AmButton>
          <AmButton
            onDark
            disabled={busy}
            onClick={() =>
              call("/api/proposals/bulk-reject", { items: items(selected), reason: "Not a transfer" }, bulkMessage("Rejected")).then(() =>
                setSelected([]),
              )
            }
          >
            Not transfers
          </AmButton>
          <AmButton
            variant="primary"
            disabled={busy}
            onClick={() => call("/api/proposals/bulk-accept", { items: items(selected) }, bulkMessage("Accepted")).then(() => setSelected([]))}
          >
            Accept {selected.length}
          </AmButton>
        </div>
      )}

      {view === "unmatched" && selectedTxns.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Selected transactions">
          <span className="count">
            {money(txOut)} out, {money(txIn)} in
          </span>
          <AmButton onDark disabled={busy} onClick={() => setSelectedTxns([])}>
            Clear
          </AmButton>
          <AmButton
            variant="primary"
            disabled={busy || txOut === 0 || txIn === 0}
            onClick={() =>
              call("/api/matches/manual", { transactionIds: selectedTxns }, () => "Matched. Your books are updated.").then(() =>
                setSelectedTxns([]),
              )
            }
          >
            Match as transfer
          </AmButton>
        </div>
      )}

      {open && (
        <Drawer
          p={open}
          userId={userId}
          busy={busy}
          onClose={() => setOpenId(null)}
          onAccept={() => accept(open)}
          onReject={(reason) => reject(open, reason)}
          onUndo={() => call(`/api/proposals/${open.id}/undo`, { version: open.version }, () => "Undone. Reversing entries posted.")}
        />
      )}

      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
          {toast.text}
          {toast.action && (
            <button
              className="action"
              onClick={() => {
                const run = toast.action!.run;
                setToast(null);
                run();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
