// Domain vocabulary shared by the whole stack: the database's CHECK
// constraints, the services, the API responses and the UI components all use
// these lists. Ambrook shares TypeScript types across frontend, backend and
// mobile; this is that idea in one file.
//
// A test (lib/domain.test.ts) reads db/schema.sql and fails if the database's
// allowed values ever drift from these lists. Components map over them with
// Record<...> types, so adding a status here without a pill for it fails the
// build.

export const PROPOSAL_STATUSES = ["proposed", "applied", "rejected", "superseded", "reversed"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MATCH_TIERS = ["high", "review"] as const;
export type MatchTier = (typeof MATCH_TIERS)[number];

export const MATCH_KINDS = ["same_entity", "intercompany", "owner"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const MATCH_SOURCES = ["matcher", "manual"] as const;
export type MatchSource = (typeof MATCH_SOURCES)[number];

export const SALE_DECISIONS = ["confirmed", "dismissed"] as const;
export type SaleDecision = (typeof SALE_DECISIONS)[number];

/** Money is always integer cents, from the database to the screen. Formatting happens only in the design system. */
export type Cents = number;
