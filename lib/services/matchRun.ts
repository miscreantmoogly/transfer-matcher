// One matching run: load what's matchable, run the pure matcher, and reconcile
// its plan with the proposals already in the database.
//
// Runs in the background worker (never in a web request). Re-running is
// always safe: unchanged proposals keep their id and version, so a reviewer
// who has one open isn't disturbed; proposals the new plan no longer contains
// are marked 'superseded'.

import type { DB } from "../db";
import { addDays } from "../dates";
import { findTransfers, type MatcherConfig } from "../matcher";

/** Only look this far back from the newest transaction: cost stays flat as history grows. */
export const LOOKBACK_DAYS = 120;

export type MatchRunSummary = {
  considered: number;
  created: number;
  kept: number;
  updated: number;
  superseded: number;
  unmatched: number;
};

export function runMatching(db: DB, actor = "system:worker", config?: Partial<MatcherConfig>): MatchRunSummary {
  const run = db.transaction((): MatchRunSummary => {
    const latest = (db.prepare("SELECT max(posted_date) AS d FROM bank_transactions").get() as { d: string | null }).d;
    if (!latest) return { considered: 0, created: 0, kept: 0, updated: 0, superseded: 0, unmatched: 0 };

    // Matchable = recent, and not already part of an APPLIED match. Transactions
    // in 'proposed' matches are re-evaluated: new data can produce a better pairing.
    const txns = db
      .prepare(
        `SELECT t.id, t.account_id, t.posted_date, t.amount_cents, t.memo
           FROM bank_transactions t
          WHERE t.posted_date >= ?
            AND NOT EXISTS (
              SELECT 1 FROM match_legs l JOIN match_proposals p ON p.id = l.proposal_id
               WHERE l.transaction_id = t.id AND l.active = 1 AND p.status = 'applied')`,
      )
      .all(addDays(latest, -LOOKBACK_DAYS)) as {
      id: number;
      account_id: string;
      posted_date: string;
      amount_cents: number;
      memo: string;
    }[];

    const accounts = db.prepare("SELECT id, entity_id AS entityId, last4 FROM bank_accounts").all() as {
      id: string;
      entityId: string;
      last4: string;
    }[];
    const entities = db.prepare("SELECT id, name FROM entities").all() as { id: string; name: string }[];
    const rejected = new Set(
      (db.prepare("SELECT legs_key FROM rejected_matches").all() as { legs_key: string }[]).map((r) => r.legs_key),
    );

    const result = findTransfers({
      transactions: txns.map((t) => ({
        id: String(t.id),
        accountId: t.account_id,
        postedDate: t.posted_date,
        amountCents: t.amount_cents,
        memo: t.memo,
      })),
      accounts,
      entities,
      rejectedLegsKeys: rejected,
      config,
    });

    // ---- Reconcile the new plan with the open proposals ------------------
    const open = db
      .prepare("SELECT id, legs_key, confidence, tier, reasons FROM match_proposals WHERE status = 'proposed'")
      .all() as { id: number; legs_key: string; confidence: number; tier: string; reasons: string }[];
    const openByKey = new Map(open.map((p) => [p.legs_key, p]));
    const planKeys = new Set(result.proposals.map((p) => p.legsKey));

    const summary: MatchRunSummary = {
      considered: txns.length,
      created: 0,
      kept: 0,
      updated: 0,
      superseded: 0,
      unmatched: result.unmatchedIds.length,
    };

    // 1. Retire stale proposals FIRST, freeing their transactions, so the
    //    inserts below don't trip the one-live-match-per-transaction index.
    const retire = db.prepare(
      "UPDATE match_proposals SET status = 'superseded', version = version + 1 WHERE id = ? AND status = 'proposed'",
    );
    const deactivateLegs = db.prepare("UPDATE match_legs SET active = 0 WHERE proposal_id = ?");
    for (const p of open) {
      if (planKeys.has(p.legs_key)) continue;
      retire.run(p.id);
      deactivateLegs.run(p.id);
      summary.superseded++;
    }

    // 2. Insert new proposals; refresh changed ones; leave identical ones alone.
    const insertProposal = db.prepare(
      `INSERT INTO match_proposals (status, kind, source, tier, confidence, reasons, legs_key, fee_cents)
       VALUES ('proposed', ?, 'matcher', ?, ?, ?, ?, ?)`,
    );
    const insertLeg = db.prepare(
      "INSERT INTO match_legs (proposal_id, transaction_id, direction, active) VALUES (?, ?, ?, 1)",
    );
    const refresh = db.prepare(
      "UPDATE match_proposals SET tier = ?, confidence = ?, reasons = ?, version = version + 1 WHERE id = ?",
    );
    for (const p of result.proposals) {
      const reasons = JSON.stringify(p.reasons);
      const existing = openByKey.get(p.legsKey);
      if (existing) {
        if (existing.confidence !== p.score || existing.tier !== p.tier || existing.reasons !== reasons) {
          refresh.run(p.tier, p.score, reasons, existing.id);
          summary.updated++;
        } else summary.kept++;
        continue;
      }
      const id = Number(insertProposal.run(p.kind, p.tier, p.score, reasons, p.legsKey, p.feeCents).lastInsertRowid);
      for (const t of p.outIds) insertLeg.run(id, Number(t), "out");
      for (const t of p.inIds) insertLeg.run(id, Number(t), "in");
      summary.created++;
    }

    db.prepare("INSERT INTO audit_log (actor, action, details) VALUES (?, 'match_run', ?)").run(
      actor,
      JSON.stringify({ ...summary, stats: result.stats }),
    );
    return summary;
  });
  return run.immediate();
}
