/**
 * How a day states itself. Ported from `ios/TripMateKit/Sources/TripMateKit/DayDisplay.swift`.
 *
 * **No `Date` is constructed anywhere in this file, and that is the point.** `2026-09-19` parses
 * as UTC midnight, so any local-timezone formatter rolls it back a day everywhere west of
 * Greenwich — a bug this codebase has already shipped once into generated output. Splitting the
 * string cannot have a timezone, so the bug is unreachable rather than merely avoided.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Parts = { year: number; month: number; day: number };

/** The one parser every spelling shares, so they cannot disagree about what a date is. */
function split(iso: string): Parts | null {
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month, day };
}

const suffix = (year: number) => String(year).slice(-2);

/**
 * The current year, read the one place a clock is unavoidable. Injectable everywhere below so the
 * year-suffix rule is testable without one.
 */
const thisYear = () => new Date().getFullYear();

/** `2026-09-19` → `Sep 19`, and `Sep 19, '27` in any year but this one. */
export function formatDate(iso: string, currentYear?: number): string {
  const date = split(iso);
  if (!date) return iso;
  const base = `${MONTHS[date.month - 1]} ${date.day}`;
  // The year is only worth the space when it is not the obvious one.
  const current = currentYear ?? thisYear();
  return date.year === current ? base : `${base}, '${suffix(date.year)}`;
}

/**
 * Zeller's congruence, returning 0 = Sunday so it indexes `WEEKDAYS` directly.
 *
 * A weekday is the one part that looks like it needs a calendar, so it comes out of arithmetic on
 * the three integers `split` already produced rather than from a formatter that would want a
 * timezone.
 */
function weekdayIndex({ year, month, day }: Parts): number {
  // January and February count as months 13 and 14 of the preceding year.
  const m = month < 3 ? month + 12 : month;
  const y = month < 3 ? year - 1 : year;
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h =
    (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  // Zeller yields 0 = Saturday; shift so 0 = Sunday.
  return (h + 6) % 7;
}

/**
 * `2026-09-19` → `Saturday, 19 September`. The day masthead, set in the serif.
 *
 * The year is never printed: this sits under a `DAY n OF m` overline inside a trip whose dates
 * the traveller chose, where a year is noise.
 */
export function formatDateline(iso: string): string {
  const date = split(iso);
  if (!date) return iso;
  return `${WEEKDAYS[weekdayIndex(date)]}, ${date.day} ${FULL_MONTHS[date.month - 1]}`;
}

/**
 * `2026-09-12`, `2026-09-20` → `Sep 12 – 20`. One month named once.
 *
 * **The collapse tests the month *and* the year, and the second half is the whole reason this is
 * not two `formatDate` calls with a dash between them.** `2026-09-19` to `2027-09-19` is the same
 * month number a year apart, and collapsing it prints `Sep 19 – 19`, which says a trip lasted a
 * day when it lasted a year.
 *
 * When the year does need saying it goes on the **end**: `Sep 19 – 23, '27` reads as one range in
 * 2027, where `Sep 19, '27 – 23` reads as a typo.
 */
export function formatRange(start: string, end: string, currentYear?: number): string {
  const from = split(start);
  const to = split(end);
  if (!from || !to) return `${start} – ${end}`;
  const current = currentYear ?? thisYear();
  if (from.year !== to.year || from.month !== to.month) {
    return `${formatDate(start, current)} – ${formatDate(end, current)}`;
  }
  const head = `${MONTHS[from.month - 1]} ${from.day}`;
  const tail = from.year === current ? `${to.day}` : `${to.day}, '${suffix(from.year)}`;
  return `${head} – ${tail}`;
}

/**
 * `2026-09-19` → `{ dayOfMonth: '19', weekday: 'Sat' }`, for the day strip's chips.
 *
 * The month is deliberately absent: the strip sits directly under the trip's own date range,
 * which names it once. What a chip has to answer is "which day of the week am I about to land
 * on", and a bare ordinal — `1 2 3` — could not.
 *
 * Returns `null` on an unparseable date rather than a placeholder, so the caller falls back to
 * the ordinal instead of printing something wrong beside a real date.
 */
export function formatDayChip(iso: string): { dayOfMonth: string; weekday: string } | null {
  const date = split(iso);
  if (!date) return null;
  return { dayOfMonth: String(date.day), weekday: SHORT_WEEKDAYS[weekdayIndex(date)] };
}
