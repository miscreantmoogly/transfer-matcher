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

/**
 * Signed number of business days from `from` to `to`.
 * Fri -> Mon is 1, same day is 0, and Mon -> previous Fri is -1.
 * Counts weekdays in the half-open interval (from, to].
 */
export function businessDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  let a = parseDate(sign > 0 ? from : to);
  const b = parseDate(sign > 0 ? to : from);
  let count = 0;
  while (a < b) {
    a = new Date(a.getTime() + DAY_MS);
    if (!isWeekend(a)) count++;
  }
  return sign * count;
}

/** Every business day in [start, end], inclusive. */
export function businessDaysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekend(parseDate(d))) days.push(d);
  }
  return days;
}
