// The one place money and dates are formatted for display. The backend always
// sends integer cents (see Cents in lib/domain.ts) and plain YYYY-MM-DD dates.

import type { Cents } from "@/lib/domain";

const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** $1,234.56 */
export const formatMoney = (cents: Cents) => exact.format(cents / 100);

/** $1,235 */
export const formatMoneyWhole = (cents: Cents) => whole.format(Math.round(cents / 100));

/** Financial-statement style: 1,235 / (1,235) for negatives / — for zero. */
export function formatAccounting(cents: Cents): string {
  const dollars = Math.round(cents / 100);
  if (dollars === 0) return "—";
  const s = Math.abs(dollars).toLocaleString("en-US");
  return dollars < 0 ? `(${s})` : s;
}

/** "Jul 14" */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
