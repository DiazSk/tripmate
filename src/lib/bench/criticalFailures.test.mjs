/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/criticalFailures.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { criticalFailures } from "./criticalFailures.ts";

/** Only the fields the gate reads — every one set to its passing value. */
const clean = () => ({
  constraints: { byType: { opening_hours: 0, closed_day: 0, daylight: 0, pace: 0, mobility: 0, crowd_bias: 0 } },
  feasibility: { overlaps: 0 },
  commitments: { breaches: [] },
  mustInclude: { missing: [], violated: [] },
  coverage: { missingAnchors: [] },
  budget: { budgetUsedFraction: 0.9 },
  duplicates: { repeats: 0, hardRepeats: 0 },
  dietary: { contradictions: 0 },
});

test("a clean run passes the gate", () => {
  assert.deepEqual(criticalFailures(clean()), []);
});

const cases = [
  ["closed_or_hours", (s) => (s.constraints.byType.closed_day = 1)],
  ["closed_or_hours", (s) => (s.constraints.byType.opening_hours = 2)],
  ["pace", (s) => (s.constraints.byType.pace = 1)],
  ["mobility", (s) => (s.constraints.byType.mobility = 1)],
  ["overlap", (s) => (s.feasibility.overlaps = 1)],
  ["commitment", (s) => s.commitments.breaches.push({ dayIndex: 0, name: "x", reason: "departure" })],
  ["must_include", (s) => s.mustInclude.missing.push("Louvre")],
  ["excluded", (s) => s.mustInclude.violated.push({ term: "bar", stopName: "Bar X" })],
  ["missing_anchor", (s) => s.coverage.missingAnchors.push("Kinkaku-ji")],
  ["over_budget", (s) => (s.budget.budgetUsedFraction = 1.2)],
  ["duplicate", (s) => (s.duplicates.hardRepeats = 1)],
  ["dietary", (s) => (s.dietary.contradictions = 1)],
];
for (const [code, breakIt] of cases) {
  test(`${code} is critical`, () => {
    const s = clean();
    breakIt(s);
    assert.deepEqual(criticalFailures(s), [code]);
  });
}

test("soft conditions never fail the gate", () => {
  const s = clean();
  s.constraints.byType.crowd_bias = 3;
  s.constraints.byType.daylight = 2;
  s.budget.budgetUsedFraction = 0.4; // under target is not a breach — §5 is a ceiling
  assert.deepEqual(criticalFailures(s), []);
  s.budget.budgetUsedFraction = null; // and unmeasurable is not a breach either
  assert.deepEqual(criticalFailures(s), []);
});

test("an unmeasured dietary score is not a failure", () => {
  const s = clean();
  s.dietary = { contradictions: 0, normalized: null };
  assert.deepEqual(criticalFailures(s), []);
});

test("travel_leg is only checked when the typed itinerary is supplied", () => {
  const tight = {
    tier: "comfort",
    days: [
      {
        date: "2026-09-19",
        weather: "",
        stops: [
          { name: "A", lat: 35.0, lng: 135.7, cost: 0, note: "", time: "9:00 AM", durationLabel: "1h", category: "entry" },
          { name: "B", lat: 35.1, lng: 135.9, cost: 0, note: "", time: "10:05 AM", durationLabel: "1h", category: "entry" },
        ],
      },
    ],
  };
  assert.deepEqual(criticalFailures(clean()), [], "no itinerary, no travel check");
  assert.deepEqual(criticalFailures(clean(), { itinerary: tight, modes: ["walk"] }), ["travel_leg"]);
});

test("duplicate gates on hard repeats only", () => {
  const s = clean();
  s.duplicates = { repeats: 4, hardRepeats: 0 };
  assert.deepEqual(criticalFailures(s), []);
  s.duplicates.hardRepeats = 1;
  assert.deepEqual(criticalFailures(s), ["duplicate"]);
});

test("a stop at 0,0 does not make a travel leg infeasible", () => {
  const plan = {
    tier: "comfort",
    days: [
      {
        date: "2026-09-19",
        weather: "",
        stops: [
          { name: "Kinkaku-ji", lat: 35.0394, lng: 135.7292, cost: 0, note: "", time: "9:00 AM", durationLabel: "1h", category: "entry" },
          { name: "Unresolved Stop", lat: 0, lng: 0, cost: 0, note: "", time: "10:15 AM", durationLabel: "1h", category: "entry" },
        ],
      },
    ],
  };
  assert.deepEqual(criticalFailures(clean(), { itinerary: plan, modes: ["walk"] }), []);
});

/* The leg check reads `evaluateDay`, not `evaluateItinerary`, because a leg that cannot reach a
 * BOOKED stop is reported as a `commitment` rather than a `travel` finding. Matching `travel`
 * alone would have quietly stopped failing the gate on the worst legs there are. */
test("a leg that cannot reach a booked stop still fails the gate", () => {
  const stop = (over) => ({
    name: "A",
    lat: 35.0,
    lng: 135.7,
    cost: 0,
    note: "",
    time: "9:00 AM",
    durationLabel: "1h",
    category: "entry",
    ...over,
  });
  const missed = {
    tier: "comfort",
    days: [
      {
        date: "2026-09-19",
        weather: "",
        stops: [
          stop({}),
          stop({ name: "Dinner", lat: 35.1, lng: 135.9, time: "10:05 AM", timeFlexibility: "FIXED" }),
        ],
      },
    ],
  };
  assert.deepEqual(criticalFailures(clean(), { itinerary: missed, modes: ["walk"] }), ["travel_leg"]);
});

// The other half: a commitment finding that did NOT come from a leg (an already-paid stay) must
// not be read as one, or `commitment` and `travel_leg` would both fire for one problem.
test("an already-paid stay is not mistaken for a broken leg", () => {
  const paid = {
    tier: "comfort",
    days: [
      {
        date: "2026-09-19",
        weather: "",
        lodging: { name: "Hotel Ronda", cost: 200, note: "" },
        stops: [
          { name: "A", lat: 35.0, lng: 135.7, cost: 0, note: "", time: "9:00 AM", durationLabel: "1h", category: "entry" },
        ],
      },
    ],
  };
  assert.deepEqual(
    criticalFailures(clean(), { itinerary: paid, modes: ["walk"] }),
    [],
    "checkCommitments findings are counted by commitments.breaches, not by the leg check"
  );
});
