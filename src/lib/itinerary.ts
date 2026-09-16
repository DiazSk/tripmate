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

export type BudgetSegment = {
  dayIndex: number;
  /** This day's spend — the figure the tip prints, always the true total even where the span
   *  drawing it has been truncated by the budget running out. */
  spend: number;
  /** Percent of the track this day occupies. */
  width: number;
  /** Percent offset of its left edge. Only the tip needs this; the spans themselves are laid
   *  out by flow. */
  left: number;
};

/**
 * The budget bar's fill, cut into one span per day.
 *
 * **Here rather than in `BudgetBar.tsx`, for the reason this whole section exists.** The docblock
 * above records three independent summations that disagreed on screen; the fix was making every
 * figure come from one place. Splitting the bar adds another reading of the same numbers, so it
 * belongs beside them — and `npm test` can only reach pure modules, so arithmetic left inside a
 * component is arithmetic nothing checks.
 *
 * **It is not a fourth summation.** Each width is `daySpend(day) / budget`, and the bar's own total
 * is `tripSpend`, which is *defined* as the sum of `daySpend`. The spans therefore add up to the
 * bar's fill by construction rather than by coincidence.
 *
 * **One denominator, always the budget.** A span's length means the same thing under, at and over
 * budget. Over budget the days fill in order and the day that crosses is drawn partial; days after
 * it get nothing. That truncation is not a fallback, it is the honest reading — *the budget ran out
 * on day four* — and it is why the spans sum to exactly 100 with no rounding slack.
 *
 * The rejected alternative was rescaling every span by `budget / spent` so all days stay visible.
 * It keeps the last day hoverable and it quietly swaps the denominator to the spend the moment you
 * cross, so a span would mean "share of budget" on Monday and "share of spend" on Tuesday. One
 * length with two meanings, on the surface whose entire argument is that money means one thing.
 *
 * Zero-spend days are dropped rather than returned at zero width: a zero-width span still draws its
 * separator, which is a hairline sitting on the bar marking nothing.
 */
export function budgetSegments(days: DayPlan[], budget: number): BudgetSegment[] {
  if (!(budget > 0)) return [];

  const out: BudgetSegment[] = [];
  let used = 0;
  days.forEach((day, dayIndex) => {
    // Clamped at zero because a negative cost off the model would otherwise *give back* room to
    // the days after it. The tip still prints the true `daySpend`.
    const spend = Math.max(0, daySpend(day));
    const width = Math.min(100 - used, (spend / budget) * 100);
    // Drops zero-spend days and every day past the point the budget ran out, and keeps `used`
    // honest for the days that remain.
    if (width <= 0) return;
    out.push({ dayIndex, spend, width, left: used });
    used += width;
  });
  return out;
}

/* ---------------------------------------------------------------------------
   Parse boundary
   --------------------------------------------------------------------------- */

/**
 * Why a stored itinerary should be refused, or null if it is fine.
 *
 * **The dividing line is repairable vs not, and it is the same line `normalizeDays` draws.** That
 * function coerces a junk `cost` to 0 and an unknown `category` to "other", because a plan is
 * still a plan without them. A missing coordinate cannot be coerced into anything — there is no
 * default location — and a stop carrying one takes the trip page down: `useDayRoute` builds an
 * OSRM key with `lat.toFixed(5)` during server render and 500s the route. `normalizeDays` drops
 * those on read, which keeps the page up but silently discards a stop somebody sent. Refusing at
 * the write is what makes the drop a backstop rather than the policy.
 *
 * Deliberately narrow. It checks the shape the storage layer and the map actually depend on —
 * days is a list, each day's stops is a list, every stop has a real location — and nothing else.
 * Everything a reader can repair is left to `normalizeDays`, so this never rejects a plan that
 * would have rendered.
 *
 * Returns the reason rather than a boolean so the 400 can name the offending stop; a client that
 * posts a malformed plan is a bug being debugged, not a traveller being told off.
 */
export function itineraryRejection(itinerary: unknown): string | null {
  if (!itinerary || typeof itinerary !== "object") return "The itinerary is missing.";
  const days = (itinerary as { days?: unknown }).days;
  if (!Array.isArray(days)) return "The itinerary has no days.";

  for (let d = 0; d < days.length; d++) {
    const day = days[d] as { stops?: unknown } | null;
    if (!day || typeof day !== "object") return `Day ${d + 1} is not a day.`;
    // An empty day is legitimate — a travel day, or one the traveller cleared.
    const stops = day.stops === undefined ? [] : day.stops;
    if (!Array.isArray(stops)) return `Day ${d + 1} has no list of stops.`;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i] as { lat?: unknown; lng?: unknown; name?: unknown } | null;
      if (!stop || typeof stop !== "object") return `Day ${d + 1}, stop ${i + 1} is not a stop.`;
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) {
        const name = typeof stop.name === "string" && stop.name ? ` (${stop.name})` : "";
        return `Day ${d + 1}, stop ${i + 1}${name} has no coordinates.`;
      }
    }
  }
  return null;
}

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
    stops: (Array.isArray(day.stops) ? day.stops : [])
      // **A stop with no coordinates is dropped, not repaired.** `Stop.lat`/`lng` are typed
      // `number` and the type says this cannot happen; `POST /api/trips` stores whatever
      // `itinerary` it is handed with no validation, so it does. What it costs is not a missing
      // marker: `useDayRoute` builds an OSRM cache key with `lat.toFixed(5)` and throws during
      // **server render**, so the whole trip page 500s — and on the client `undefined` becomes
      // `NaN`, MapLibre throws `Invalid LngLat object: (NaN, NaN)` out of the draw, and the
      // camera is stranded wherever it was. Both observed on one real trip page.
      //
      // Dropped here, at the one boundary every reader shares, because the consumers derive
      // their own coordinate arrays independently — `ItineraryCard` builds `routeDays` for the
      // map and `dayPoints` for the routing, from the same `day.stops`, in two separate memos —
      // so guarding per consumer means finding all of them, now and later. It also keeps the
      // list and the map agreeing about what the day contains, which a map-only filter would not.
      .filter((stop: Stop) => Number.isFinite(stop?.lat) && Number.isFinite(stop?.lng))
      .map((stop: Stop) => ({
        ...stop,
        cost: money(stop.cost),
        category: normalizeCategory(stop.category),
        tags: Array.isArray(stop.tags) ? stop.tags : [],
      })),
  }));
}

/**
 * Refill each revised day's `summary` from the day it replaces, where the revision left it out.
 *
 * The critique pass returns a whole corrected day set and `runGeneration` applies it wholesale, so
 * any field the response omits is a field the plan loses. `summary` is the one that actually went
 * missing: `buildCritiquePrompt`'s response shape did not list it while `buildGeneratePrompt`'s
 * did, and `ItineraryCard` renders it — so a compliant critique silently erased every day's
 * narrative. The shapes agree now, which is the necessary half of the fix; this is the half that
 * does not depend on the model complying with them.
 *
 * **Matched by date, never by position.** Critique is told to keep the same dates but is not
 * stopped from returning fewer days, and an index match would then hand day 2 day 1's narrative —
 * a wrong summary reads as a real edit, which is worse than a missing one. A day with no
 * counterpart keeps no summary at all.
 *
 * Mutates, matching `annotateConflicts` and `pinAdmissionCosts`, which the runner applies to the
 * same array in the same breath.
 */
export function carryOverDaySummaries(revised: DayPlan[], previous: DayPlan[]): void {
  const byDate = new Map<string, string>();
  for (const day of previous) {
    // A blank summary is not worth carrying and would only overwrite `undefined` with noise.
    if (day?.date && day.summary?.trim()) byDate.set(day.date, day.summary);
  }
  if (byDate.size === 0) return;
  for (const day of revised) {
    if (!day || day.summary?.trim()) continue;
    const inherited = byDate.get(day.date);
    if (inherited) day.summary = inherited;
  }
}

export interface DayActiveSpan {
  /** First stop's start and last stop's end, both as "8:00 AM". */
  start: string;
  end: string;
  /** Start to end in minutes, travel and gaps included — the §12c fatigue number. */
  minutes: number;
}

/** "8:00 AM" / "8 AM" / "14:00" → minutes since midnight, or null if unparseable. */
export function parseClock(time: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(time);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const meridiem = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  // 12-hour input only when a meridiem says so; "14:00" is already 24-hour.
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** "2 hours" / "1.5 hours" / "45 minutes" → minutes. 0 when there's nothing to read. */
export function parseDuration(label: string): number {
  const m = /(\d+(?:\.\d+)?)\s*(h|hr|hour|hours|m|min|mins|minute|minutes)/i.exec(label);
  if (!m) return 0;
  const value = Number(m[1]);
  return /^h/i.test(m[2]) ? Math.round(value * 60) : Math.round(value);
}

export function formatClock(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(total % 60).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

/**
 * How long the day actually runs, end to end.
 *
 * Computed here rather than asked of the model: judging "is this day too long" against the
 * pace guardrail means comparing a number to a threshold, and a model handed raw clock times
 * has to derive that number first — which it reliably narrates in prose and then fails to act
 * on. Handing it the total instead turns the check into a comparison.
 *
 * Takes the earliest start and the latest end across the day's stops rather than trusting array
 * order, and returns null when no stop carries a readable time.
 */
export function dayActiveSpan(day: DayPlan): DayActiveSpan | null {
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const stop of day.stops) {
    const start = parseClock(stop.time ?? "");
    if (start === null) continue;
    const end = start + parseDuration(stop.durationLabel ?? "");
    if (earliest === null || start < earliest) earliest = start;
    if (latest === null || end > latest) latest = end;
  }

  if (earliest === null || latest === null) return null;
  return { start: formatClock(earliest), end: formatClock(latest), minutes: latest - earliest };
}
