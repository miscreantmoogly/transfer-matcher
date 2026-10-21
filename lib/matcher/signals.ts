// Memo signals: small, explainable features extracted from bank memos.
// Each one maps to a human-readable reason shown in the review UI, because a
// reviewer should be able to see WHY the matcher thinks two lines belong together.

import { naiveCategorize } from "../categorize";
import type { EntityInfo } from "./types";

const TRANSFER_WORDS = /\b(TRANSFER|XFER|TRSF|WIRE)\b/;

// Words that appear in lots of business names and so don't identify anyone.
const GENERIC_NAME_WORDS = new Set(["CO", "LLC", "INC", "LTD", "CATTLE", "RANCH", "FARM", "FARMS", "THE", "AND", "COMPANY"]);

export function hasTransferWords(memo: string): boolean {
  return TRANSFER_WORDS.test(memo.toUpperCase());
}

/** True if the memo contains these exact 4 digits as their own token (e.g. "...4821"). */
export function mentionsLast4(memo: string, last4: string): boolean {
  return new RegExp(`(^|\\D)${last4}(\\D|$)`).test(memo);
}

/** Distinctive words in an entity's name, e.g. "Cedar Creek Cattle Co." -> ["CEDAR", "CREEK"]. */
export function distinctiveNameTokens(entityName: string): string[] {
  return entityName
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
}

export function mentionsEntity(memo: string, entity: EntityInfo): boolean {
  const words = new Set(memo.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/));
  return distinctiveNameTokens(entity.name).some((t) => words.has(t));
}

/**
 * Reference numbers (4+ digits) that appear in both memos, e.g. a wire's
 * "REF 88412". Account last-4s are excluded because they're a separate signal.
 */
export function sharedReferences(memoA: string, memoB: string, ignore: string[]): string[] {
  const refs = (m: string) => new Set((m.match(/\d{4,}/g) ?? []).filter((r) => !ignore.includes(r)));
  const a = refs(memoA);
  return [...refs(memoB)].filter((r) => a.has(r));
}

/** The account last-4s a memo references, written the way banks do: "...4821". */
export function referencedLast4s(memo: string): string[] {
  return memo.match(/\.\.\.(\d{4})/g)?.map((m) => m.slice(3)) ?? [];
}

/**
 * The memo names an account that is NOT one of the accounts in this pair:
 * it's pointing somewhere else, which is evidence against the match.
 */
export function pointsElsewhere(memo: string, pairLast4s: string[]): boolean {
  return referencedLast4s(memo).some((d) => !pairLast4s.includes(d));
}

/**
 * Does this look like ordinary commerce (a feed bill, a cattle sale)?
 * Reuses the categorizer: if it recognized a vendor, it's probably not a transfer.
 */
export function looksLikeCommerce(memo: string, amountCents: number): boolean {
  return !naiveCategorize(memo, amountCents).startsWith("uncategorized");
}

export const isRoundHundreds = (cents: number) => Math.abs(cents) % 100_00 === 0;
