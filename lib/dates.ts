// Date helpers. Dates are plain "YYYY-MM-DD" strings (bank posting dates have
// no time-of-day or timezone), and all arithmetic happens in UTC so a laptop's
// local timezone can never shift a date by one day.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addDays(iso: string, days: number): string {
  return formatDate(new Date(parseDate(iso).getTime() + days * DAY_MS));
}

/** Move forward (or backward, if n < 0) by n business days. Holidays are ignored. */
export function addBusinessDays(iso: string, n: number): string {
  let date = parseDate(iso);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    date = new Date(date.getTime() + step * DAY_MS);
    if (!isWeekend(date)) remaining--;
  }
  return formatDate(date);
}

/** Days since 1970-01-01 (a Thursday). Memoized: the same few hundred dates are compared millions of times. */
const dayNumbers = new Map<string, number>();
const dayNumber = (iso: string) => {
  let n = dayNumbers.get(iso);
  if (n === undefined) {
    n = Math.round(parseDate(iso).getTime() / DAY_MS);
    dayNumbers.set(iso, n);
  }
  return n;
};

// Weekdays among the first r days of a week that starts on a Thursday:
// Thu Fri Sat Sun Mon Tue Wed -> 1 1 0 0 1 1 1, as running totals.
const WEEKDAY_PREFIX = [0, 1, 2, 2, 2, 3, 4, 5];
/** Number of weekdays among day numbers 0 .. n-1 (n >= 0). O(1). */
const weekdaysBefore = (n: number) => Math.floor(n / 7) * 5 + WEEKDAY_PREFIX[n % 7];

/**
 * Signed number of business days from `from` to `to`.
 * Fri -> Mon is 1, same day is 0, and Mon -> previous Fri is -1.
 * Counts weekdays in the half-open interval (from, to].
 *
 * Constant time: this runs for every candidate pair, so an earlier
 * day-by-day loop made matching super-linear for large customers.
 */
export function businessDaysBetween(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return weekdaysBefore(b + 1) - weekdaysBefore(a + 1);
}

/** Every business day in [start, end], inclusive. */
export function businessDaysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekend(parseDate(d))) days.push(d);
  }
  return days;
}
