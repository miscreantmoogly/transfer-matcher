// The demo customer: a fictional family cattle operation run as two legal
// entities. The son runs Cedar Creek Cattle Co. and also keeps the books for
// his father's Hollis Ranch LLC, so money moves between the two all the time.

export type EntityDef = { id: string; name: string; shortName: string };
export type BankAccountDef = { id: string; entityId: string; name: string; last4: string };
export type UserDef = { id: string; name: string; role: string; entityIds: string[] };

export const ENTITIES: EntityDef[] = [
  { id: "cedar", name: "Cedar Creek Cattle Co.", shortName: "CEDAR CREEK CATTLE" },
  { id: "hollis", name: "Hollis Ranch LLC", shortName: "HOLLIS RANCH" },
];

export const BANK_ACCOUNTS: BankAccountDef[] = [
  { id: "cedar-chk", entityId: "cedar", name: "Cedar Operating Checking", last4: "4821" },
  { id: "cedar-sav", entityId: "cedar", name: "Cedar Reserve Savings", last4: "7730" },
  { id: "hollis-chk", entityId: "hollis", name: "Hollis Operating Checking", last4: "1956" },
  { id: "hollis-sav", entityId: "hollis", name: "Hollis Equipment Savings", last4: "3307" },
];

export const USERS: UserDef[] = [
  // The owner-operator: sees and manages both entities.
  { id: "wes", name: "Wes (owner)", role: "owner", entityIds: ["cedar", "hollis"] },
  // A part-time bookkeeper who only works on Hollis Ranch's books.
  { id: "dana", name: "Dana (Hollis bookkeeper)", role: "bookkeeper", entityIds: ["hollis"] },
];

export type CategoryDef = {
  slug: string;
  name: string;
  type: "income" | "expense";
};

export const CATEGORIES: CategoryDef[] = [
  { slug: "cattle_sales", name: "Cattle Sales", type: "income" },
  { slug: "hay_sales", name: "Hay Sales", type: "income" },
  { slug: "gov_payments", name: "Government Program Payments", type: "income" },
  { slug: "interest_income", name: "Interest Income", type: "income" },
  { slug: "uncategorized_income", name: "Uncategorized Income", type: "income" },
  { slug: "feed", name: "Feed", type: "expense" },
  { slug: "fuel", name: "Fuel", type: "expense" },
  { slug: "vet", name: "Vet & Medicine", type: "expense" },
  { slug: "repairs", name: "Repairs & Maintenance", type: "expense" },
  { slug: "labor", name: "Labor", type: "expense" },
  { slug: "uncategorized_expense", name: "Uncategorized Expense", type: "expense" },
];

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
