// Pills for backend values. The prop types come straight from lib/domain.ts,
// the same lists the database's CHECK constraints use, and each map is a
// Record over that type: add a status on the backend without a label here and
// the build fails. That's the "full-stack" part of the design system.

import type { JSX } from "react";
import type { MatchKind, MatchSource, MatchTier, ProposalStatus } from "@/lib/domain";
import { AmPill, type AmPillTone } from "./AmPill";

const TIER: Record<MatchTier, { short: string; long: string; tone: AmPillTone }> = {
  high: { short: "Strong", long: "Strong match", tone: "positive" },
  review: { short: "Check", long: "Check this one", tone: "caution" },
};

export function AmTierPill({ tier, long = false, className }: { tier: MatchTier; long?: boolean; className?: string }): JSX.Element {
  const t = TIER[tier];
  return (
    <AmPill tone={t.tone} className={className}>
      {long ? t.long : t.short}
    </AmPill>
  );
}

const STATUS: Record<ProposalStatus, { label: string; tone: AmPillTone }> = {
  proposed: { label: "Waiting for review", tone: "caution" },
  applied: { label: "Accepted", tone: "positive" },
  rejected: { label: "Not a transfer", tone: "negative" },
  superseded: { label: "Replaced", tone: "neutral" },
  reversed: { label: "Undone", tone: "negative" },
};

export function AmStatusPill({ status, source }: { status: ProposalStatus; source?: MatchSource }): JSX.Element {
  const s = STATUS[status];
  return <AmPill tone={s.tone}>{source === "manual" && status === "applied" ? "Matched by hand" : s.label}</AmPill>;
}

export const KIND_LABEL: Record<MatchKind, string> = {
  same_entity: "Between your accounts",
  intercompany: "Between your businesses",
  owner: "Owner's personal account",
};

export function AmKindPill({ kind }: { kind: MatchKind }): JSX.Element {
  return <AmPill>{KIND_LABEL[kind]}</AmPill>;
}
