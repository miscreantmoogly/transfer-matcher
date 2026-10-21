"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, BooksPanel, Guide, MatchCard, UnmatchedTable } from "./components";
import { moneyWhole, shortDate, type AppState } from "./lib";

type Tab = "ready" | "review" | "unmatched" | "done";

export default function Page() {
  const [userId, setUserId] = useState("wes");
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ready");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [guideOpen, setGuideOpen] = useState(true);
  const userRef = useRef(userId);
  userRef.current = userId;

  // ---- Data -------------------------------------------------------------------
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
    try {
      const saved = localStorage.getItem("tm.guideOpen");
      if (saved !== null) setGuideOpen(saved === "1");
    } catch {}
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (!state) {
    return (
      <main className="layout">
        <div className="empty">
          <h2>{loadError ? "Can't reach the database" : "Loading…"}</h2>
          {loadError && <p>{loadError}</p>}
        </div>
      </main>
    );
  }

  // ---- Derived ---------------------------------------------------------------
  const ready = state.proposals.filter((p) => p.tier === "high");
  const review = state.proposals.filter((p) => p.tier === "review");
  const latest = state.counts.latestPostedDate;
  const nextBatch = state.counts.bankTransactions === 0 ? 1 : latest && latest <= "2026-09-25" ? 2 : null;
  const pendingJob = state.jobs.recent.find((j) => j.status === "queued" || j.status === "running");
  const workerLooksDown =
    pendingJob?.status === "queued" && Date.now() - new Date(pendingJob.run_after).getTime() > 6000;

  const tabs: [Tab, string, number][] = [
    ["ready", "Ready to accept", ready.length],
    ["review", "Worth a look", review.length],
    ["unmatched", "Unmatched", state.unmatched.length],
    ["done", "Done", state.decided.length],
  ];

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1>Transfer Matcher</h1>
          <span>{state.books.entities.map((e) => e.entityName).join(" and ")}</span>
        </div>
        <div className="spacer" />
        <label className="acting">
          Acting as
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setState(null);
            }}
          >
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn primary"
          disabled={busy || nextBatch === null}
          onClick={() =>
            call("/api/sync", { batch: nextBatch }, (r) =>
              r.inserted ? `Pulled in ${r.inserted} new transactions. Looking for transfers…` : "No new transactions.",
            )
          }
        >
          {nextBatch === 1 ? "Sync bank" : nextBatch === 2 ? "Sync again" : "Up to date"}
        </button>
      </header>

      <div className="layout">
        <main>
          <Guide
            state={state}
            open={guideOpen}
            onToggle={() => {
              setGuideOpen(!guideOpen);
              try {
                localStorage.setItem("tm.guideOpen", guideOpen ? "0" : "1");
              } catch {}
            }}
          />

          {pendingJob && !workerLooksDown && (
            <div className="notice working" role="status">
              <span className="pulse" aria-hidden="true" />
              <span className="grow">Looking for transfers in the new bank activity…</span>
            </div>
          )}
          {workerLooksDown && (
            <div className="notice warn" role="status">
              <span className="grow">
                The matcher hasn&apos;t picked this up. Is the worker running? (<code>npm run worker</code>)
              </span>
              <button className="btn small" disabled={busy} onClick={() => call("/api/match/run", {}, (r) => `Found ${r.created} new matches.`)}>
                Run it here instead
              </button>
            </div>
          )}
          {state.hiddenProposals > 0 && (
            <div className="notice info">
              {state.hiddenProposals} more match{state.hiddenProposals === 1 ? "" : "es"} involve a business you
              don&apos;t have access to. Someone who can see both sides will need to review{" "}
              {state.hiddenProposals === 1 ? "it" : "them"}.
            </div>
          )}

          {state.counts.bankTransactions === 0 ? (
            <div className="empty">
              <h2>No bank activity yet</h2>
              <p>
                Sync your banks to pull in the latest transactions. We&apos;ll look for money you moved between your own
                accounts and businesses, so it doesn&apos;t show up as income or expenses.
              </p>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => call("/api/sync", { batch: 1 }, (r) => `Pulled in ${r.inserted} new transactions.`)}
              >
                Sync bank
              </button>
            </div>
          ) : (
            <>
              <div className="tabs" role="tablist">
                {tabs.map(([id, label, count]) => (
                  <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                    {label}
                    <span className="count">{count}</span>
                  </button>
                ))}
              </div>

              {tab === "ready" && (
                <>
                  <div className="queue-head">
                    <p>
                      Strong matches: same amount, close dates, and the memos point at each other. Skim them, then accept
                      them together.
                    </p>
                    {ready.length > 0 && (
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() =>
                          call(
                            "/api/proposals/bulk-accept",
                            { items: ready.map((p) => ({ id: p.id, version: p.version })) },
                            (r: { ok: boolean }[]) => {
                              const ok = r.filter((x) => x.ok).length;
                              return ok === r.length
                                ? `Accepted ${ok} matches.`
                                : `Accepted ${ok} of ${r.length}. The rest changed while you were looking; refresh and check them.`;
                            },
                          )
                        }
                      >
                        Accept all {ready.length}
                      </button>
                    )}
                  </div>
                  {ready.length === 0 && <EmptyQueue text="Nothing waiting here." />}
                  {ready.map((p) => (
                    <MatchCard
                      key={p.id}
                      p={p}
                      busy={busy}
                      compact={p.tier === "high"}
                      onAccept={() => call(`/api/proposals/${p.id}/accept`, { version: p.version }, () => "Accepted. Your books are updated.")}
                      onReject={(reason) =>
                        call(`/api/proposals/${p.id}/reject`, { version: p.version, reason }, () => "Got it. We won't suggest that pairing again.")
                      }
                    />
                  ))}
                </>
              )}

              {tab === "review" && (
                <>
                  <div className="queue-head">
                    <p>
                      Likely transfers we&apos;re less sure about: vague memos, slow banks, fees, or one payment split
                      across accounts. Check each one.
                    </p>
                  </div>
                  {review.length === 0 && <EmptyQueue text="Nothing to review." />}
                  {review.map((p) => (
                    <MatchCard
                      key={p.id}
                      p={p}
                      busy={busy}
                      onAccept={() => call(`/api/proposals/${p.id}/accept`, { version: p.version }, () => "Accepted. Your books are updated.")}
                      onReject={(reason) =>
                        call(`/api/proposals/${p.id}/reject`, { version: p.version, reason }, () => "Got it. We won't suggest that pairing again.")
                      }
                    />
                  ))}
                </>
              )}

              {tab === "unmatched" && (
                <>
                  <div className="queue-head">
                    <p>
                      Everything not part of a match. If you spot a transfer we missed, like a check you wrote to your
                      other business, select both sides and match them yourself.
                    </p>
                  </div>
                  <UnmatchedTable
                    txns={state.unmatched}
                    busy={busy}
                    onMatch={(ids) =>
                      call("/api/matches/manual", { transactionIds: ids }, () => "Matched. Your books are updated.")
                    }
                  />
                </>
              )}

              {tab === "done" && (
                <>
                  <div className="queue-head">
                    <p>Everything you&apos;ve decided. Undo posts a reversing entry; nothing is ever deleted.</p>
                  </div>
                  {state.decided.length === 0 && <EmptyQueue text="No decisions yet." />}
                  {state.decided.map((p) => (
                    <MatchCard
                      key={p.id}
                      p={p}
                      busy={busy}
                      compact
                      onUndo={() => call(`/api/proposals/${p.id}/undo`, { version: p.version }, () => "Undone. Your books are back to how they were.")}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </main>

        <aside className="aside">
          {state.counts.bankTransactions > 0 && <BooksPanel books={state.books} />}
          <Activity audit={state.audit} users={state.users} />
          <section className="panel">
            <h2>Demo controls</h2>
            <p className="lede">
              {state.counts.bankTransactions} bank transactions loaded
              {latest ? `, through ${shortDate(latest)}` : ""}.
              {state.books.intercompanyNetCents !== null && state.counts.applied > 0
                ? ` ${moneyWhole(state.books.entities.reduce((s, e) => s + e.incomeBeforeCents - e.incomeNowCents, 0))} of fake income removed so far.`
                : ""}
            </p>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => call("/api/reset", {}, () => "Reset. Start again with Sync bank.")}
            >
              Reset demo
            </button>
          </section>
        </aside>
      </div>

      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
    </>
  );
}

function EmptyQueue({ text }: { text: string }) {
  return (
    <div className="empty">
      <p style={{ margin: 0 }}>{text}</p>
    </div>
  );
}
