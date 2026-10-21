// The demo customer: a fictional family cattle operation, the Hollis family.
//
//   Cedar Creek Cattle Co.  the son (Wes) runs it
//   Hollis Ranch LLC        his father's ranch; Wes keeps its books too
//   Hollis Land Co.         holds the family's land and leases pasture to both ranches
//   Wes Hollis (personal)   Wes's own checking account, connected so owner's
//                           draws and contributions can be recognized
//
// Money moves between all four in different ways: loans between the ranches,
// sweeps between a business's own accounts, owner's draws, and real
// intercompany business (pasture rent, a hay sale) that is NOT a transfer.

export type EntityKind = "business" | "personal";
export type EntityDef = { id: string; name: string; shortName: string; kind: EntityKind };
/** openingBalanceCents: the balance the day before the first imported transaction. */
export type BankAccountDef = { id: string; entityId: string; name: string; last4: string; openingBalanceCents: number };
export type UserDef = { id: string; name: string; role: string; entityIds: string[] };

export const ENTITIES: EntityDef[] = [
  { id: "cedar", name: "Cedar Creek Cattle Co.", shortName: "CEDAR CREEK CATTLE", kind: "business" },
  { id: "hollis", name: "Hollis Ranch LLC", shortName: "HOLLIS RANCH", kind: "business" },
  { id: "land", name: "Hollis Land Co.", shortName: "HOLLIS LAND CO", kind: "business" },
  { id: "wes", name: "Wes Hollis (personal)", shortName: "WES HOLLIS", kind: "personal" },
];

// Bank feeds start mid-history. The aggregator reports today's balance; the
// opening balance is that minus everything imported since.
export const OPENING_BALANCE_DATE = "2026-06-30";

export const BANK_ACCOUNTS: BankAccountDef[] = [
  { id: "cedar-chk", entityId: "cedar", name: "Cedar Operating Checking", last4: "4821", openingBalanceCents: 38_500_000 },
  { id: "cedar-sav", entityId: "cedar", name: "Cedar Reserve Savings", last4: "7730", openingBalanceCents: 4_000_000 },
  { id: "hollis-chk", entityId: "hollis", name: "Hollis Operating Checking", last4: "1956", openingBalanceCents: 6_000_000 },
  { id: "hollis-sav", entityId: "hollis", name: "Hollis Equipment Savings", last4: "3307", openingBalanceCents: 2_500_000 },
  { id: "land-chk", entityId: "land", name: "Land Co. Checking", last4: "5582", openingBalanceCents: 1_800_000 },
  { id: "wes-chk", entityId: "wes", name: "Wes Personal Checking", last4: "6610", openingBalanceCents: 900_000 },
];

export const USERS: UserDef[] = [
  // The owner-operator: sees and manages everything, including his own account.
  { id: "wes", name: "Wes Hollis", role: "Owner", entityIds: ["cedar", "hollis", "land", "wes"] },
  // A part-time bookkeeper who only works on Hollis Ranch's books.
  { id: "dana", name: "Dana Ortiz", role: "Bookkeeper, Hollis Ranch", entityIds: ["hollis"] },
];

export type CategoryDef = {
  slug: string;
  name: string;
  type: "income" | "expense";
};

export const CATEGORIES: CategoryDef[] = [
  { slug: "cattle_sales", name: "Cattle Sales", type: "income" },
  { slug: "hay_sales", name: "Hay Sales", type: "income" },
  { slug: "rental_income", name: "Rental Income", type: "income" },
  { slug: "gov_payments", name: "Government Program Payments", type: "income" },
  { slug: "interest_income", name: "Interest Income", type: "income" },
  { slug: "uncategorized_income", name: "Uncategorized Income", type: "income" },
  { slug: "feed", name: "Feed & Hay", type: "expense" },
  { slug: "fuel", name: "Fuel", type: "expense" },
  { slug: "vet", name: "Vet & Medicine", type: "expense" },
  { slug: "repairs", name: "Repairs & Maintenance", type: "expense" },
  { slug: "labor", name: "Labor", type: "expense" },
  { slug: "rent", name: "Pasture Rent", type: "expense" },
  { slug: "property_tax", name: "Property Tax", type: "expense" },
  { slug: "household", name: "Household", type: "expense" },
  { slug: "uncategorized_expense", name: "Uncategorized Expense", type: "expense" },
];

export const entityKind = (entityId: string): EntityKind =>
  ENTITIES.find((e) => e.id === entityId)?.kind ?? "business";

// Ledger account ids are "<entity>:<slug>" so they're readable in SQL.
export const ledgerId = (entityId: string, slug: string) => `${entityId}:${slug}`;
export const cashLedgerId = (bankAccountId: string) => {
  const acct = BANK_ACCOUNTS.find((a) => a.id === bankAccountId);
  if (!acct) throw new Error(`Unknown bank account ${bankAccountId}`);
  return ledgerId(acct.entityId, `cash_${bankAccountId}`);
};
export const clearingLedgerId = (entityId: string) => ledgerId(entityId, "transfers_in_transit");
export const bankFeesLedgerId = (entityId: string) => ledgerId(entityId, "bank_fees");
export const dueFromLedgerId = (entityId: string, other: string) => ledgerId(entityId, `due_from_${other}`);
export const dueToLedgerId = (entityId: string, other: string) => ledgerId(entityId, `due_to_${other}`);
/** Business books: money the owner took out (debit) or put in (credit). Both are equity, never income or expense. */
export const ownerDrawsLedgerId = (entityId: string) => ledgerId(entityId, "owner_draws");
export const ownerContributionsLedgerId = (entityId: string) => ledgerId(entityId, "owner_contributions");
/** Equity carried in from before the bank feed started (QuickBooks calls it Opening Balance Equity). */
export const openingEquityLedgerId = (entityId: string) => ledgerId(entityId, "opening_equity");
/** Personal books: the other side of draws and contributions. */
export const ownerTransfersLedgerId = (entityId: string) => ledgerId(entityId, "transfers_with_businesses");
