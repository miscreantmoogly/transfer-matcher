// A deliberately naive, rule-based categorizer: the kind of first pass a bank
// import does today. It knows nothing about transfers, which is the point:
// a transfer deposit lands in an income category and inflates revenue until
// someone matches it to its withdrawal.

// [pattern, category if money went out, category if money came in]
const RULES: Array<[RegExp, string, string]> = [
  [/SALE BARN|LIVESTOCK AUCTION/, "uncategorized_expense", "cattle_sales"],
  [/HAY SALE/, "feed", "hay_sales"],
  [/HAY PURCHASE/, "feed", "hay_sales"],
  [/LEASE/, "rent", "rental_income"],
  [/USDA|FSA PMT/, "uncategorized_expense", "gov_payments"],
  [/INTEREST/, "uncategorized_expense", "interest_income"],
  [/FEED/, "feed", "uncategorized_income"],
  [/FUEL|PROPANE/, "fuel", "uncategorized_income"],
  [/VET/, "vet", "uncategorized_income"],
  [/REPAIR|PARTS|EQUIP CO/, "repairs", "uncategorized_income"],
  [/PAYROLL/, "labor", "uncategorized_income"],
  [/PROPERTY TAX|TREASURER/, "property_tax", "uncategorized_income"],
  [/GROCERY|VERIZON|COSTCO|NETFLIX/, "household", "uncategorized_income"],
];

/** Returns a category slug for a bank transaction, based only on its memo and sign. */
export function naiveCategorize(memo: string, amountCents: number): string {
  const upper = memo.toUpperCase();
  for (const [pattern, ifOut, ifIn] of RULES) {
    if (pattern.test(upper)) return amountCents < 0 ? ifOut : ifIn;
  }
  return amountCents > 0 ? "uncategorized_income" : "uncategorized_expense";
}
