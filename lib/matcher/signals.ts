// Memo signals: small, explainable features extracted from bank memos.
// Each one maps to a human-readable reason shown in the review UI, because a
// reviewer should be able to see WHY the matcher thinks two lines belong together.

import { naiveCategorize } from "../categorize";
import type { EntityInfo } from "./types";

const TRANSFER_WORDS = /\b(TRANSFER|XFER|TRSF|WIRE)\b/;

// Legal suffixes don't identify anyone.
const LEGAL_SUFFIXES = new Set(["CO", "LLC", "INC", "LTD", "CORP", "COMPANY"]);

const normalize = (text: string) =>
  text
    .toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export function hasTransferWords(memo: string): boolean {
  return TRANSFER_WORDS.test(memo.toUpperCase());
}

/** True if the memo contains these exact 4 digits as their own token (e.g. "...4821"). */
export function mentionsLast4(memo: string, last4: string): boolean {
  return new RegExp(`(^|\\D)${last4}(\\D|$)`).test(memo);
}

/**
 * The phrase a bank memo would use for an entity: its first two name words.
 * "Cedar Creek Cattle Co." -> "CEDAR CREEK", "Hollis Ranch LLC" -> "HOLLIS RANCH",
 * "Hollis Land Co." -> "HOLLIS LAND". A phrase, not single words, because
 * related entities share words: "HOLLIS" alone can't tell the ranch from the land company.
 */
export function entityPhrase(entityName: string): string {
  const words = normalize(entityName);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.slice(0, 2).join(" ");
}

export function mentionsEntity(memo: string, entity: EntityInfo): boolean {
  return ` ${normalize(memo).join(" ")} `.includes(` ${entityPhrase(entity.name)} `);
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
