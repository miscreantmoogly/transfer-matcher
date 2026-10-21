// Client-side helpers: types for the API, formatting, and plain-language
// descriptions of what a match will do to the books.

import type { ProposalView, LegView } from "@/lib/services/proposals";
import type { BooksSummary, UnmatchedTxn } from "@/lib/services/books";
import type { CurrentUser } from "@/lib/auth";
import type { Job } from "@/lib/services/jobs";
import { businessDaysBetween } from "@/lib/dates";
import { entityPhrase } from "@/lib/matcher/signals";

export type { ProposalView, LegView, BooksSummary, UnmatchedTxn, CurrentUser };

export type AppState = {
  user: CurrentUser;
  users: { id: string; name: string; role: string }[];
  entities: { id: string; name: string; kind: "business" | "personal" }[];
  proposals: ProposalView[];
  decided: ProposalView[];
  hiddenProposals: number;
  unmatched: UnmatchedTxn[];
  books: BooksSummary;
  counts: { bankTransactions: number; proposed: number; applied: number; latestPostedDate: string | null };
  jobs: { queued: number; running: number; recent: Job[] };
  audit: { id: number; at: string; actor: string; action: string; proposal_id: number | null; details: string | null }[];
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const money = (cents: number) => usd.format(cents / 100);
export const moneyWhole = (cents: number) => usdWhole.format(Math.round(cents / 100));

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Same day", "1 business day", "1 day early": the label on the bracket between the two sides. */
export function gapLabel(p: ProposalView): string {
  const outs = p.legs.filter((l) => l.direction === "out");
  const ins = p.legs.filter((l) => l.direction === "in");
  let worst = 0;
  for (const o of outs) for (const i of ins) {
    const g = businessDaysBetween(o.postedDate, i.postedDate);
    if (Math.abs(g) > Math.abs(worst)) worst = g;
  }
  if (worst === 0) return "same day";
  if (worst < 0) return `${-worst} day early`;
  return `${worst} business day${worst > 1 ? "s" : ""}`;
}

export function matchTitle(p: ProposalView): string {
  const outs = p.legs.filter((l) => l.direction === "out");
  const ins = p.legs.filter((l) => l.direction === "in");
  const names = (legs: LegView[], key: "entityName" | "accountName") => [...new Set(legs.map((l) => l[key]))].join(" + ");
  const key = p.kind === "same_entity" ? "accountName" : "entityName";
  return `${names(outs, key)} to ${names(ins, key)}`;
}

/**
 * What accepting this match will do to the books, in the owner's words, not
 * an accountant's. Mirrors buildTransferEntries() on the server.
 */
export function plainEffects(p: ProposalView): string[] {
  const outs = p.legs.filter((l) => l.direction === "out");
  const ins = p.legs.filter((l) => l.direction === "in");
  const effects: string[] = [];

  // Personal-account lines aren't on any business's books, so they're only tagged.
  for (const leg of [...outs, ...ins]) {
    if (leg.entityKind === "personal") continue;
    effects.push(`Removes ${money(Math.abs(leg.amountCents))} from ${leg.importCategory} (${leg.entityName})`);
  }

  const flows =
    outs.length === 1
      ? ins.map((to) => ({ from: outs[0], to, cents: ins.length === 1 ? -outs[0].amountCents : to.amountCents }))
      : outs.map((from) => ({ from, to: ins[0], cents: -from.amountCents }));
  for (const f of flows) {
    if (f.from.entityId === f.to.entityId) continue;
    if (f.to.entityKind === "personal") {
      effects.push(`Records a ${money(f.cents)} owner's draw from ${f.from.entityName}: equity, not an expense`);
    } else if (f.from.entityKind === "personal") {
      effects.push(`Records ${money(f.cents)} the owner put into ${f.to.entityName}: equity, not income`);
    } else {
      effects.push(`Records that ${f.to.entityName} owes ${f.from.entityName} ${money(f.cents)}`);
    }
  }
  if (p.kind === "same_entity") effects.push("Money just moved between your own accounts, so profit doesn't change");
  if (p.feeCents > 0) effects.push(`Books the missing ${money(p.feeCents)} as a bank fee on ${ins[0].entityName}`);
  return effects;
}

export const KIND_LABEL: Record<string, string> = {
  same_entity: "Between your accounts",
  intercompany: "Between your businesses",
  owner: "Owner's personal account",
};

/** Reasons that count AGAINST the match get flagged in the UI. */
export const isAgainst = (reason: string) =>
  reason.includes("looks like a real") || reason.includes("points to a different") || reason.includes("isn't part of this match");

/** Short phrase for when the deposit landed relative to the withdrawal. */
export function arrivalLabel(p: ProposalView): string {
  const g = gapLabel(p);
  if (g === "same day") return "Arrived the same day";
  if (g.endsWith("early")) return "Deposit posted 1 day before";
  return `Arrived ${g} later`;
}

/**
 * The bits of a memo that point at the OTHER side of the match: its account's
 * last 4 digits, its entity's name, or a reference number both sides share.
 * Highlighting them shows a reviewer the evidence instead of just a score.
 */
export function linkingTokens(p: ProposalView, leg: LegView): string[] {
  const others = p.legs.filter((l) => l.direction !== leg.direction);
  const tokens = new Set<string>();
  for (const o of others) {
    tokens.add(o.last4);
    // The same name phrase the matcher looks for ("HOLLIS RANCH", not just "HOLLIS").
    if (o.entityId !== leg.entityId) tokens.add(entityPhrase(o.entityName));
    for (const ref of o.memo.match(/\d{4,}/g) ?? []) {
      if (leg.memo.includes(ref) && !p.legs.some((l) => l.last4 === ref)) tokens.add(ref);
    }
  }
  return [...tokens].filter((t) => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`).test(leg.memo.toUpperCase()));
}
