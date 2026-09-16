/* Run: node --test src/lib/itinerary.test.mjs
 *
 * The money path is the one piece of non-trivial logic added by the totals module,
 * and the defect it replaced was three summations quietly disagreeing. These asserts
 * are what fail if they start disagreeing again. Node strips the TypeScript itself,
 * so there is no framework and no build step here. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetSegments,
  carryOverDaySummaries,
  dayActiveSpan,
  dayPlanned,
  daySpend,
  daySpendByCategory,
  normalizeCategory,
  normalizeDays,
  tripSpend,
} from "./itinerary.ts";

const stop = (over) => ({
  name: "x",
  lat: 0,
  lng: 0,
  cost: 10,
  note: "",
  time: "",
  durationLabel: "",
  tags: [],
  category: "food",
  ...over,
});

test("tripSpend is exactly the sum of each day's breakdown total", () => {
  const days = [
    { date: "2026-09-01", weather: "", stops: [stop({}), stop({ category: "entry", cost: 5 })] },
    {
      date: "2026-09-02",
      weather: "",
      lodging: { name: "h", cost: 100, note: "" },
      stops: [stop({ category: "transit", cost: 7 })],
    },
  ];
  const byBreakdown = days.reduce((sum, d) => sum + daySpendByCategory(d).total, 0);
  assert.equal(tripSpend(days), byBreakdown);
  assert.equal(tripSpend(days), 122);
});

test("actualCost overrides cost in spend but never in the plan", () => {
  const day = {
    date: "2026-09-01",
    weather: "",
    lodging: { name: "h", cost: 100, note: "", actualCost: 130 },
    stops: [stop({ cost: 10, actualCost: 25 }), stop({ cost: 10 })],
  };
  assert.equal(dayPlanned(day), 120);
  assert.equal(daySpend(day), 165);
});

test("an unknown category lands in `other` and produces no NaN", () => {
  const day = {
    date: "2026-09-01",
    weather: "",
    stops: [stop({ category: "shopping", cost: 40 })],
  };
  const spend = daySpendByCategory(day);
  assert.equal(spend.other, 40);
  assert.equal(spend.total, 40);
  assert.ok(!Number.isNaN(spend.total));
  assert.equal(normalizeCategory("shopping"), "other");
  assert.equal(normalizeCategory(undefined), "other");
  assert.equal(normalizeCategory("food"), "food");
});

test("non-numeric costs coerce rather than poisoning the total", () => {
  const day = {
    date: "2026-09-01",
    weather: "",
    stops: [stop({ cost: "45" }), stop({ cost: undefined }), stop({ cost: null })],
  };
  assert.equal(daySpend(day), 45);
  assert.equal(dayPlanned(day), 45);
});

test("normalizeDays repairs what the model and old database rows send", () => {
  const [day] = normalizeDays([
    { date: "2026-09-01", weather: "", stops: undefined, lodging: { name: "h", cost: "80" } },
  ]);
  assert.deepEqual(day.stops, []);
  assert.equal(day.lodging.cost, 80);

  // Coordinates on the fixture because this case is about coercing `category` and `cost`, and a
  // stop with none is now dropped before it reaches either — see the test below for why.
  const [withStop] = normalizeDays([
    {
      date: "2026-09-01",
      weather: "",
      stops: [{ name: "x", lat: 41.15, lng: -8.61, cost: "12", category: "nope" }],
    },
  ]);
  assert.equal(withStop.stops[0].category, "other");
  assert.equal(withStop.stops[0].cost, 12);
  assert.deepEqual(withStop.stops[0].tags, []);

  assert.deepEqual(normalizeDays(undefined), []);
});

test("dayActiveSpan measures first start to last end, and reads both time formats", () => {
  const day = {
    date: "2026-09-01",
    weather: "",
    stops: [
      stop({ time: "8:00 AM", durationLabel: "2 hours" }),
      stop({ time: "12:00 PM", durationLabel: "45 minutes" }),
      stop({ time: "6:30 PM", durationLabel: "1.5 hours" }),
    ],
  };
  const span = dayActiveSpan(day);
  assert.equal(span.start, "8:00 AM");
  assert.equal(span.end, "8:00 PM");
  assert.equal(span.minutes, 720);

  // 24-hour input, a bare hour, and an unreadable time that must not poison the span.
  const mixed = dayActiveSpan({
    date: "2026-09-01",
    weather: "",
    stops: [
      stop({ time: "14:00", durationLabel: "1 hour" }),
      stop({ time: "9 AM", durationLabel: "30 min" }),
      stop({ time: "sometime", durationLabel: "3 hours" }),
    ],
  });
  assert.equal(mixed.start, "9:00 AM");
  assert.equal(mixed.end, "3:00 PM");
  assert.equal(mixed.minutes, 360);

  // Latest END wins, not the latest start: a long early stop can outlast a short later one.
  const overlap = dayActiveSpan({
    date: "2026-09-01",
    weather: "",
    stops: [
      stop({ time: "9:00 AM", durationLabel: "8 hours" }),
      stop({ time: "10:00 AM", durationLabel: "30 minutes" }),
    ],
  });
  assert.equal(overlap.end, "5:00 PM");
  assert.equal(overlap.minutes, 480);

  assert.equal(dayActiveSpan({ date: "2026-09-01", weather: "", stops: [] }), null);
  assert.equal(
    dayActiveSpan({ date: "2026-09-01", weather: "", stops: [stop({ time: "", durationLabel: "" })] }),
    null
  );
});

// --- carryOverDaySummaries: the day narrative the critique is prone to dropping ----------------
//
// `buildCritiquePrompt` asks for a corrected day set and the model returns the whole thing, so a
// response that omits `summary` silently erases a field the itinerary card renders. Asking for it
// in the prompt is necessary but not sufficient — this is the part that does not depend on the
// model complying.

const day = (date, extra = {}) => ({ date, weather: "clear", stops: [], ...extra });

test("a revised day with no summary inherits the one it replaced", () => {
  const revised = [day("2026-05-01"), day("2026-05-02")];
  carryOverDaySummaries(revised, [
    day("2026-05-01", { summary: "Temples, then the market." }),
    day("2026-05-02", { summary: "A slow morning by the river." }),
  ]);
  assert.equal(revised[0].summary, "Temples, then the market.");
  assert.equal(revised[1].summary, "A slow morning by the river.");
});

test("a summary the critique did write is left alone", () => {
  const revised = [day("2026-05-01", { summary: "Rewritten: museums instead." })];
  carryOverDaySummaries(revised, [day("2026-05-01", { summary: "Temples, then the market." })]);
  assert.equal(revised[0].summary, "Rewritten: museums instead.");
});

test("matching is by date, not position — a dropped day must not shift the rest", () => {
  const revised = [day("2026-05-02"), day("2026-05-03")];
  carryOverDaySummaries(revised, [
    day("2026-05-01", { summary: "one" }),
    day("2026-05-02", { summary: "two" }),
    day("2026-05-03", { summary: "three" }),
  ]);
  assert.equal(revised[0].summary, "two", "day 2 must not inherit day 1's narrative");
  assert.equal(revised[1].summary, "three");
});

test("a day with no counterpart is left without a summary rather than given a wrong one", () => {
  const revised = [day("2026-05-09")];
  carryOverDaySummaries(revised, [day("2026-05-01", { summary: "one" })]);
  assert.equal(revised[0].summary, undefined);
});

test("an empty or blank previous summary is not copied over as a blank string", () => {
  const revised = [day("2026-05-01")];
  carryOverDaySummaries(revised, [day("2026-05-01", { summary: "   " })]);
  assert.equal(revised[0].summary, undefined);
});

test("nothing to carry over is not an error", () => {
  const revised = [day("2026-05-01")];
  carryOverDaySummaries(revised, []);
  assert.equal(revised[0].summary, undefined);
});

/* budgetSegments — the budget bar's per-day split. Same reason as the asserts above: it is
 * another reading of numbers that already appear on screen, so the thing worth pinning is that it
 * cannot disagree with them. */

/** Percentages are floating-point ratios; a bit-exact assert would be testing IEEE 754, not this
 *  module. A millionth of a percent is far below one device pixel on any bar. */
const closeTo = (actual, expected, what) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: expected ~${expected}, got ${actual}`);

const dayCosting = (n) => ({
  date: "2026-09-01",
  weather: "",
  stops: n > 0 ? [stop({ cost: n })] : [],
});

const totalWidth = (segments) => segments.reduce((t, s) => t + s.width, 0);

test("budgetSegments: widths are shares of the budget, not of the spend", () => {
  // 300 spent of a 1200 budget: the fill is a quarter of the track and the two days split it.
  const segments = budgetSegments([dayCosting(100), dayCosting(200)], 1200);
  assert.equal(segments.length, 2);
  closeTo(segments[0].width, 100 / 12, "day 1 width");
  closeTo(segments[1].width, 200 / 12, "day 2 width");
  // The unfilled remainder is what "left to spend" means, so the spans must not fill the track.
  closeTo(totalWidth(segments), 25, "spans sum to the fill");
});

test("budgetSegments: the fill can never disagree with tripSpend", () => {
  const days = [dayCosting(120), dayCosting(0), dayCosting(75), dayCosting(310)];
  closeTo(totalWidth(budgetSegments(days, 1000)), (tripSpend(days) / 1000) * 100, "fill");
});

test("budgetSegments: zero-spend days are dropped, and the rest stay contiguous", () => {
  const segments = budgetSegments([dayCosting(50), dayCosting(0), dayCosting(50)], 500);
  assert.deepEqual(
    segments.map((s) => s.dayIndex),
    [0, 2]
  );
  // The surviving days butt against each other — a dropped day must not leave a gap in the fill.
  closeTo(segments[1].left, segments[0].left + segments[0].width, "no gap where day 2 was");
});

test("budgetSegments: over budget truncates chronologically and fills exactly", () => {
  // 300 of the 400 budget is gone after day 2; day 3 takes the last 100 and day 4 gets nothing.
  const segments = budgetSegments(
    [dayCosting(100), dayCosting(200), dayCosting(400), dayCosting(50)],
    400
  );
  assert.deepEqual(
    segments.map((s) => s.dayIndex),
    [0, 1, 2],
    "the day the budget ran out is the last one drawn"
  );
  // Exact, not approximate: the crossing day is given precisely the remaining width, so there is
  // no rounding slack to accumulate.
  assert.equal(totalWidth(segments), 100);
  // The truncated day still reports its true spend — the width is capped, the number is not.
  assert.equal(segments[2].spend, 400);
  assert.equal(segments[2].width, 25);
});

test("budgetSegments: a negative cost cannot give width back to later days", () => {
  const segments = budgetSegments([dayCosting(-500), dayCosting(100)], 1000);
  assert.deepEqual(
    segments.map((s) => s.dayIndex),
    [1]
  );
  assert.equal(segments[0].left, 0);
});

test("budgetSegments: no budget, or no days, yields nothing", () => {
  for (const budget of [0, -1, Number.NaN]) {
    assert.deepEqual(budgetSegments([dayCosting(100)], budget), []);
  }
  assert.deepEqual(budgetSegments([], 1000), []);
});

test("budgetSegments: a one-day trip is a single span with no separator to draw", () => {
  const segments = budgetSegments([dayCosting(250)], 1000);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], { dayIndex: 0, spend: 250, width: 25, left: 0 });
});

test("normalizeDays drops a stop with no coordinates, which would 500 the trip page", () => {
  // Not hypothetical: `POST /api/trips` stores an unvalidated itinerary, and `useDayRoute` then
  // builds an OSRM key with `lat.toFixed(5)` during server render.
  const [day] = normalizeDays([
    {
      date: "2026-10-10",
      stops: [
        { name: "no coords", cost: 0, category: "sight" },
        { name: "placed", lat: 41.147, lng: -8.6148, cost: 10, category: "sight" },
      ],
    },
  ]);
  assert.deepEqual(
    day.stops.map((s) => s.name),
    ["placed"]
  );
});

test("normalizeDays keeps 0/0, which is a real coordinate and not a missing one", () => {
  const [day] = normalizeDays([
    { date: "2026-10-10", stops: [{ name: "Null Island", lat: 0, lng: 0, cost: 0, category: "sight" }] },
  ]);
  assert.equal(day.stops.length, 1);
});
