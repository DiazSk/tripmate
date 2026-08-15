import type { DayPlan, Itinerary, Lodging, Stop, StopCategory } from "./types";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-09-10" -> "Sep 10" if 2026 is the current year, else "Sep 10, '26".
 * Parses the ISO date as a local calendar date via manual split rather than
 * `new Date(iso)` (which parses as UTC midnight and can roll back a day for
 * anyone west of Greenwich) — same reasoning as `todayISO` in src/app/page.tsx.
 */
export function formatItineraryDate(iso: string): string {
  const parts = (iso ?? "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return iso ?? "";
  const [year, month, day] = parts;
  const monthName = MONTH_NAMES[month - 1];
  if (!monthName) return iso;
  const base = `${monthName} ${day}`;
  return year === new Date().getFullYear() ? base : `${base}, '${String(year).slice(2)}`;
}

/** Matches by name+lat+lng rather than object identity — callers often hold a
 *  Stop reference that's a structural copy of the one inside `itinerary`. */
export function findStopLocation(
  itinerary: Itinerary,
  stop: Stop
): { dayIndex: number; stopIndex: number } | null {
  for (let d = 0; d < itinerary.days.length; d++) {
    const s = itinerary.days[d].stops.findIndex(
      (x) => x.name === stop.name && x.lat === stop.lat && x.lng === stop.lng
    );
    if (s !== -1) return { dayIndex: d, stopIndex: s };
  }
  return null;
}

/** Remaining stops for the same day, after the given stop — used to power the
 *  "Next up" quick-navigation list in PlaceDetailPanel. */
export function upcomingStopsAfter(itinerary: Itinerary, stop: Stop): Stop[] {
  const loc = findStopLocation(itinerary, stop);
  if (!loc) return [];
  return itinerary.days[loc.dayIndex].stops.slice(loc.stopIndex + 1);
}

/* ---------------------------------------------------------------------------
   Money
   ---------------------------------------------------------------------------
   Every figure on screen comes from one of the functions below. There used to
   be three independent summations — BudgetBar, TripView and ItineraryCard's
   breakdown tiles — and they disagreed: two of them ignored `actualCost` and
   only one guarded against a non-numeric cost, so entering a real spend on
   /trip/[id] moved the overspend banner but not the budget bar. Two totals for
   one number, on screen together.
   --------------------------------------------------------------------------- */

/** Anything that reached us from the model or from a SQLite JSON round-trip is
 *  `unknown` in practice: `"45"`, `null` and `undefined` all turn up. */
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const CATEGORIES: readonly StopCategory[] = ["food", "entry", "transit", "other"];

/** The model is told to use one of four values (see itineraryPrompt) but it is
 *  still a language model, and `Stop.category` is typed as if it weren't. */
export function normalizeCategory(v: unknown): StopCategory {
  return CATEGORIES.includes(v as StopCategory) ? (v as StopCategory) : "other";
}

/** What the plan *said* a day would cost. The baseline the overspend delta is
 *  measured against, and the one summation that deliberately ignores actuals. */
export function dayPlanned(day: DayPlan): number {
  return (
    money(day.lodging?.cost) +
    day.stops.reduce((sum, stop) => sum + money(stop.cost), 0)
  );
}

/** A stop or lodging's real cost once one has been entered, its estimate until then. */
function spendOf(item: Stop | Lodging | undefined): number {
  if (!item) return 0;
  return item.actualCost != null ? money(item.actualCost) : money(item.cost);
}

export type DaySpend = Record<StopCategory | "stay", number> & { total: number };

export function daySpendByCategory(day: DayPlan): DaySpend {
  const sums = { food: 0, entry: 0, transit: 0, other: 0, stay: 0, total: 0 };
  for (const stop of day.stops) sums[normalizeCategory(stop.category)] += spendOf(stop);
  sums.stay = spendOf(day.lodging);
  sums.total = sums.food + sums.entry + sums.transit + sums.other + sums.stay;
  return sums;
}

/** Deliberately delegates rather than reducing again: the breakdown's Total tile
 *  *is* this day's contribution to the budget bar, so the two cannot drift. */
export function daySpend(day: DayPlan): number {
  return daySpendByCategory(day).total;
}

export function tripSpend(days: DayPlan[]): number {
  return days.reduce((sum, day) => sum + daySpend(day), 0);
}

/* ---------------------------------------------------------------------------
   Parse boundary
   --------------------------------------------------------------------------- */

/** Runs on every itinerary entering the app from the model or from the database.
 *  `Stop.category: StopCategory` and `cost: number` are contracts the type system
 *  asserts and nothing enforced: an unrecognised category used to land in no
 *  budget bucket at all (rendering `$NaN`) and blow up `CATEGORY_ICON[category]`
 *  into `<undefined />`, which throws. Normalizing at the door means every reader
 *  downstream gets what the types promise. */
export function normalizeDays(days: unknown): DayPlan[] {
  if (!Array.isArray(days)) return [];
  return days.map((day: DayPlan) => ({
    ...day,
    lodging: day.lodging && { ...day.lodging, cost: money(day.lodging.cost) },
    stops: (Array.isArray(day.stops) ? day.stops : []).map((stop: Stop) => ({
      ...stop,
      cost: money(stop.cost),
      category: normalizeCategory(stop.category),
      tags: Array.isArray(stop.tags) ? stop.tags : [],
    })),
  }));
}
