import type { DayPlan } from '@/api/types';
import { aboutDuration } from '@shared/travelTime';
/**
 * How a day states itself. Ported from the earlier SwiftUI client.
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

/**
 * The badge over the photograph — and **only ever something we were told, never something the
 * model wrote.**
 *
 * This used to fall back to `day.weather` when no forecast was attached, cut at its first
 * clause so it would fit. That fallback was the bug. `day.weather` is written by the planner,
 * and when no forecast exists the planner has nothing to write it from — the stored value on a
 * real Lisbon trip is `"Pleasant autumn day, 18.9-23.5°C, mostly sunny"`, temperatures included,
 * none of it observed. Truncating at the comma dropped the invented figures and kept the
 * invented claim, in the one position on the screen that means "this is the weather".
 *
 * So: structured figures or nothing. It used to fall back to `theme` as a "safe second choice",
 * but the hero prints `theme` as its title directly above this line, so a day without a forecast
 * said its own name twice ("Baixa arrival, gentle orientation" over "Day 1 of 7 · Baixa arrival,
 * gentle orientation"). A day with no figures says no weather; `dayLine` still gives it a date.
 *
 * `historical` says the numbers are last year's same-date weather rather than a forecast, which
 * is cheap to say and worth saying. The sun is only drawn for a forecast whose WMO code is clear
 * or mainly clear (0-1): a glyph on a rainy day would be the invented claim this guards against,
 * and last year's sky is no forecast at all.
 */
export function weatherLine(day: DayPlan): string | undefined {
  const detail = day.weatherDetail;
  if (!detail) return undefined;
  const temps = `${Math.round(detail.tempMaxC)}° / ${Math.round(detail.tempMinC)}°`;
  if (detail.historical) return `${temps}  ·  typical`;
  return detail.weatherCode !== null && detail.weatherCode <= 1 ? `☀ ${temps}` : temps;
}

/**
 * The hero's line under the day's name, as the design (trip-2C) sets it: `Day 2 of 7 · Fri, Nov 7`,
 * then the weather when there is some. The date comes off the string, never a `Date` — see the top
 * of this file — so it cannot roll back a day west of Greenwich.
 */
export function dayLine(day: DayPlan, dayIndex: number, dayCount: number): string {
  const date = split(day.date);
  const when = date ? `${SHORT_WEEKDAYS[weekdayIndex(date)]}, ${MONTHS[date.month - 1]} ${date.day}` : null;
  return [`Day ${dayIndex + 1} of ${dayCount}`, when, weatherLine(day)].filter(Boolean).join(' · ');
}

/**
 * A stored timestamp as a wall clock — "21:27" — or null when it will not parse.
 *
 * Three surfaces say when a cached copy was taken: the trip screen's banner, Today's banner, and
 * Today's forecast line, which has to change tense offline. Null rather than a fallback string,
 * because a fabricated time on a line whose entire job is to date the data would be the exact
 * failure these lines exist to prevent.
 */
export function clockAt(iso: string | null): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(when);
}


/**
 * `1:00 PM  ·  1.5 hours  ·  Food` — what a stop is, under its name.
 *
 * Two surfaces say this now: the list row and the map's stop card. It is here rather than in
 * either of them because the thing that would drift is the *set* — add `timeFlexibility` to one
 * and the two faces of the same stop start disagreeing about what a stop is.
 *
 * Empty whenever nothing can be said, which is a real case: a stop added by hand carries no
 * time and no duration until the plan is regenerated.
 *
 * `category` is stored lowercase (`'food'`, `'entry'`) and used to be capitalised by the label
 * step's `textTransform`. Sentence case has to happen in the string, or the line reads "· food".
 *
 * On an imported plan, what TripMate supplied rather than the traveller reads "about …" — the
 * estimates spec's rule that the hedge belongs in the sentence.
 */
export function stopParticulars(stop: {
  time?: string;
  durationLabel?: string;
  category?: string;
  /** Fields TripMate supplied on an imported plan; hedged in words, per the estimates rule. */
  estimated?: readonly string[];
}): string {
  const hedge = (field: string, value: string | undefined) =>
    value && stop.estimated?.includes(field) ? aboutDuration(value) : value;
  // "Other" is the absence of a category, not one; printed it reads as filler ("45 minutes · Other").
  const category = stop.category?.trim().toLowerCase() === 'other' ? undefined : sentence(stop.category);
  return [hedge('time', stop.time), hedge('duration', stop.durationLabel), category]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('  ·  ');
}

/** First letter up, rest untouched — the categories are single lowercase words. */
function sentence(word: string | undefined): string | undefined {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * Which day the chat's narrow half means: the scope chosen, else the day the chat was opened
 * about ("Fix this" on a stop), else the day on screen. It used to fall back to the first day, so
 * opened from Ask on day 3 the half said "Day 1" and pressing it scoped the turn to the wrong day.
 */
export const scopeDay = (scope: number | null, initial: number | null | undefined, current: number): number =>
  scope ?? initial ?? current;
