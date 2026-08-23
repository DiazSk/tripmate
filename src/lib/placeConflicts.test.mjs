/* Run: node --test src/lib/placeConflicts.test.mjs
 *
 * The load-bearing case is the weekday calculation. Calendar dates in this app are parsed as UTC
 * midnight, so `new Date("2026-09-10").getDay()` is Wednesday while `.getUTCDay()` is Thursday —
 * verified in this repo's runtime. A `getDay()` slip here fails silently in the worst way: it
 * checks the wrong day's hours, inventing closures that don't exist while missing the real ones.
 * That is strictly worse than having no check, so the day mapping is pinned explicitly.
 *
 * The rest pins the deliberate division of labour: code flags only what it can be certain of
 * (a published "Closed"), and carries the hours string onward so a model can judge time-of-day
 * clashes without this module shipping a parser for "9–11 AM, 12–3 PM, 5–8 PM". */
import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateBookAhead,
  annotateConflicts,
  closedOnDate,
  crowdLevelAt,
  detectConflicts,
  pinAdmissionCosts,
  selectStopsToEnrich,
  weekdayOf,
} from "./placeConflicts.ts";

const louvre = {
  hoursByDay: { sunday: "9 AM–6 PM", monday: "9 AM–6 PM", tuesday: "Closed", wednesday: "9 AM–9 PM", thursday: "9 AM–6 PM", friday: "9 AM–9 PM", saturday: "9 AM–6 PM" },
  admissionUsd: 37.39,
  accessibility: ["Wheelchair accessible entrance"],
  bookAhead: true,
  rating: 4.7,
};

const stairsOnly = { hoursByDay: null, admissionUsd: null, accessibility: ["Wheelchair accessible parking lot"], bookAhead: false, rating: 4.2 };

const factsFor = (entries) => new Map(entries);
const day = (date, stops) => ({ date, weather: "", stops });

test("resolves the weekday in UTC, not local time", () => {
  // 2026-09-10 is Thursday in UTC and Wednesday west of Greenwich. This is the whole ballgame.
  assert.equal(weekdayOf("2026-09-10"), "thursday");
  assert.equal(weekdayOf("2026-09-15"), "tuesday");
  assert.equal(weekdayOf("2026-11-19"), "thursday");
});

test("fires on a real closed day", () => {
  assert.equal(closedOnDate(louvre, "2026-09-15"), true);
});

test("does not fire one day either side of the closure", () => {
  // The off-by-one a getDay() slip would produce lands exactly here.
  assert.equal(closedOnDate(louvre, "2026-09-14"), false);
  assert.equal(closedOnDate(louvre, "2026-09-16"), false);
});

test("treats absent hours as unknown, never as closed", () => {
  // Asserting a closure we cannot see is the same class of error as inventing an opening time.
  assert.equal(closedOnDate(stairsOnly, "2026-09-15"), false);
});

test("detects a stop scheduled on a closed day and carries the published hours onward", () => {
  const days = [day("2026-09-15", [{ name: "Louvre Museum", category: "entry", cost: 50, note: "Iconic." }])];
  const [conflict] = detectConflicts(days, factsFor([["louvre museum", louvre]]));
  assert.equal(conflict.kind, "closed");
  assert.equal(conflict.stopName, "Louvre Museum");
  assert.equal(conflict.publishedHours, "Closed");
});

test("matches facts through the model's capitalisation and punctuation drift", () => {
  const days = [day("2026-09-15", [{ name: "Louvre  Museum!", category: "entry", cost: 50, note: "" }])];
  assert.equal(detectConflicts(days, factsFor([["louvre museum", louvre]])).length, 1);
});

test("reports nothing for a stop it has no facts about", () => {
  const days = [day("2026-09-15", [{ name: "Some Alley", category: "other", cost: 0, note: "" }])];
  assert.deepEqual(detectConflicts(days, factsFor([["louvre museum", louvre]])), []);
});

test("flags unconfirmed step-free access only when it was actually required", () => {
  const days = [day("2026-09-16", [{ name: "Old Tower", category: "entry", cost: 10, note: "" }])];
  const facts = factsFor([["old tower", stairsOnly]]);
  assert.deepEqual(detectConflicts(days, facts), []);
  const [conflict] = detectConflicts(days, facts, { stepFreeRequired: true });
  assert.equal(conflict.kind, "access");
});

test("does not flag access when a wheelchair entrance is confirmed", () => {
  const days = [day("2026-09-16", [{ name: "Louvre Museum", category: "entry", cost: 50, note: "" }])];
  assert.deepEqual(detectConflicts(days, factsFor([["louvre museum", louvre]]), { stepFreeRequired: true }), []);
});

test("annotates additively, keeping the model's own rationale", () => {
  const days = [day("2026-09-15", [{ name: "Louvre Museum", category: "entry", cost: 50, note: "Iconic collection." }])];
  const conflicts = detectConflicts(days, factsFor([["louvre museum", louvre]]));
  assert.equal(annotateConflicts(days, conflicts), 1);
  assert.match(days[0].stops[0].note, /Iconic collection\./);
  assert.match(days[0].stops[0].note, /Closed on this date/);
});

test("does not annotate the same stop twice", () => {
  const days = [day("2026-09-15", [{ name: "Louvre Museum", category: "entry", cost: 50, note: "" }])];
  const conflicts = detectConflicts(days, factsFor([["louvre museum", louvre]]));
  annotateConflicts(days, conflicts);
  assert.equal(annotateConflicts(days, conflicts), 0);
});

test("skips annotation for a stop critique already removed", () => {
  const conflicts = [{ date: "2026-09-15", stopName: "Gone", publishedHours: "Closed", kind: "closed" }];
  assert.equal(annotateConflicts([day("2026-09-15", [])], conflicts), 0);
});

test("pins an entry cost to real admission", () => {
  // Measured live: a generated Paris itinerary priced the Louvre at $50 against a real $37.39.
  const days = [day("2026-09-16", [{ name: "Louvre Museum", category: "entry", cost: 50, note: "" }])];
  assert.equal(pinAdmissionCosts(days, factsFor([["louvre museum", louvre]])), 1);
  assert.equal(days[0].stops[0].cost, 37.39);
});

test("leaves a cost alone when there is no admission data to pin it to", () => {
  const days = [day("2026-09-16", [{ name: "Old Tower", category: "entry", cost: 10, note: "" }])];
  assert.equal(pinAdmissionCosts(days, factsFor([["old tower", stairsOnly]])), 0);
  assert.equal(days[0].stops[0].cost, 10);
});

test("enriches entry stops and skips the ones where the data changes nothing", () => {
  // Cost control: the spike measured ~91 metered calls for one 44-stop trip without this.
  const days = [
    day("2026-09-16", [
      { name: "Louvre Museum", category: "entry", cost: 50, note: "" },
      { name: "Metro to Bastille", category: "transit", cost: 2, note: "" },
      { name: "Walk the Marais", category: "other", cost: 0, note: "" },
    ]),
  ];
  assert.deepEqual(selectStopsToEnrich(days), ["Louvre Museum"]);
});

test("enriches every stop when step-free access is required", () => {
  // §9e outranks the cost control: a building they cannot enter is the worst outcome.
  const days = [day("2026-09-16", [{ name: "A", category: "other", cost: 0, note: "" }, { name: "B", category: "transit", cost: 0, note: "" }])];
  assert.deepEqual(selectStopsToEnrich(days, { stepFreeRequired: true }), ["A", "B"]);
});

test("never pins a price onto a stop that is not a ticketed entry", () => {
  // Regression: with step-free access required, EVERY stop gets looked up — and Google returned an
  // $11.10 reseller price for the free Jardin du Luxembourg, which landed on the plan as the cost
  // of walking through a public park.
  const park = { hoursByDay: null, admissionUsd: 11.1, accessibility: [], bookAhead: false, rating: 4.7, title: "Jardin du Luxembourg" };
  const days = [
    day("2026-09-15", [
      { name: "Jardin du Luxembourg", category: "other", cost: 0, note: "" },
      { name: "Lunch nearby", category: "food", cost: 40, note: "" },
    ]),
  ];
  assert.equal(pinAdmissionCosts(days, factsFor([["jardin du luxembourg", park], ["lunch nearby", park]])), 0);
  assert.equal(days[0].stops[0].cost, 0);
  assert.equal(days[0].stops[1].cost, 40);
});

/* Crowd data and book-ahead extend Phase 2 with facts already fetched in the same call — no new
 * cost, but the wiring is new and worth its own load-bearing case: a traveler who said "love" or
 * "mixed" crowds must never get flagged for the exact same busy hour that "avoid" gets flagged
 * for, since a busy iconic stop is the point for them, not a defect. */

const busyEiffel = {
  hoursByDay: null,
  admissionUsd: 17.29,
  accessibility: [],
  bookAhead: true,
  rating: 4.7,
  title: "Eiffel Tower",
  crowdByDay: {
    tuesday: [
      { time: "9 AM", busyness: 20 },
      { time: "2 PM", busyness: 85 },
      { time: "6 PM", busyness: 40 },
    ],
  },
};

const quietMuseum = {
  hoursByDay: null,
  admissionUsd: 10,
  accessibility: [],
  bookAhead: false,
  rating: 4.1,
  title: "Small Museum",
  crowdByDay: null,
};

test("resolves busyness from the closest published hour bucket", () => {
  // The stop's exact time ("2:15 PM") won't exactly match an hourly bucket ("2 PM").
  assert.equal(crowdLevelAt(busyEiffel, "2026-09-15", "2:15 PM"), 85);
  assert.equal(crowdLevelAt(busyEiffel, "2026-09-15", "9:05 AM"), 20);
});

test("returns null rather than a guess when there is no crowd data for that day", () => {
  assert.equal(crowdLevelAt(quietMuseum, "2026-09-15", "2:00 PM"), null);
  assert.equal(crowdLevelAt(busyEiffel, "2026-09-16", "2:00 PM"), null); // wednesday, not tuesday
});

test("returns null when the stop's own time doesn't parse", () => {
  assert.equal(crowdLevelAt(busyEiffel, "2026-09-15", "sometime"), null);
});

test("flags a busy hour only for a traveler who asked to avoid crowds", () => {
  const days = [day("2026-09-15", [{ name: "Eiffel Tower", category: "entry", cost: 17, time: "2:00 PM", note: "" }])];
  const facts = factsFor([["eiffel tower", busyEiffel]]);

  assert.deepEqual(detectConflicts(days, facts), []); // no crowdBias given at all
  assert.deepEqual(detectConflicts(days, facts, { crowdBias: "love" }), []);
  assert.deepEqual(detectConflicts(days, facts, { crowdBias: "mixed" }), []);

  const [conflict] = detectConflicts(days, facts, { crowdBias: "avoid" });
  assert.equal(conflict.kind, "crowd");
  assert.equal(conflict.crowdScore, 85);
});

test("does not flag a quiet hour even when crowds must be avoided", () => {
  const days = [day("2026-09-15", [{ name: "Eiffel Tower", category: "entry", cost: 17, time: "9:00 AM", note: "" }])];
  assert.deepEqual(
    detectConflicts(days, factsFor([["eiffel tower", busyEiffel]]), { crowdBias: "avoid" }),
    []
  );
});

test("annotates the busy hour with a plain warning, not the raw score", () => {
  const days = [day("2026-09-15", [{ name: "Eiffel Tower", category: "entry", cost: 17, time: "2:00 PM", note: "" }])];
  const conflicts = detectConflicts(days, factsFor([["eiffel tower", busyEiffel]]), { crowdBias: "avoid" });
  annotateConflicts(days, conflicts);
  assert.match(days[0].stops[0].note, /Usually very busy/);
});

test("flags a bookAhead stop with a deterministic note", () => {
  const days = [day("2026-09-15", [{ name: "Eiffel Tower", category: "entry", cost: 17, note: "Iconic view." }])];
  assert.equal(annotateBookAhead(days, factsFor([["eiffel tower", busyEiffel]])), 1);
  assert.match(days[0].stops[0].note, /Book ahead/);
});

test("does not double-flag a stop whose note already mentions booking ahead", () => {
  const days = [day("2026-09-15", [{ name: "Eiffel Tower", category: "entry", cost: 17, note: "Book ahead for summit access." }])];
  assert.equal(annotateBookAhead(days, factsFor([["eiffel tower", busyEiffel]])), 0);
});

test("does nothing for a place with no book-ahead signal", () => {
  const days = [day("2026-09-15", [{ name: "Small Museum", category: "entry", cost: 10, note: "" }])];
  assert.equal(annotateBookAhead(days, factsFor([["small museum", quietMuseum]])), 0);
});
