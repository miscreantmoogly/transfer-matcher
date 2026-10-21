// A deliberately naive, rule-based categorizer: the kind of first pass a bank
// import does today. It knows nothing about transfers, which is the point:
// a transfer deposit lands in an income category and inflates revenue until
// someone matches it to its withdrawal.

const RULES: Array<[RegExp, string]> = [
  [/SALE BARN|LIVESTOCK AUCTION/, "cattle_sales"],
  [/HAY SALE/, "hay_sales"],
  [/USDA|FSA PMT/, "gov_payments"],
  [/INTEREST/, "interest_income"],
  [/FEED/, "feed"],
  [/FUEL|PROPANE/, "fuel"],
  [/VET/, "vet"],
  [/REPAIR|PARTS|EQUIP CO/, "repairs"],
  [/PAYROLL/, "labor"],
];

/** Returns a category slug for a bank transaction, based only on its memo and sign. */
export function naiveCategorize(memo: string, amountCents: number): string {
  const upper = memo.toUpperCase();
  for (const [pattern, slug] of RULES) {
    if (pattern.test(upper)) return slug;
  }
  return amountCents > 0 ? "uncategorized_income" : "uncategorized_expense";
}
