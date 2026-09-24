/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs
 *
 * `evaluateBudget` and `BudgetBar` show the traveler the same sum from two different places, and
 * this file exists because they must not disagree — two surfaces contradicting each other about
 * whether a trip is over budget is precisely the drift the contract docblock in itinerary.ts was
 * written about. */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBudget, evaluateDay, evaluateItinerary } from "./guardrails.ts";

/** One stop, one day, priced to whatever the case needs. */
const itineraryCosting = (cost) => ({
  tier: "midrange",
  days: [
    {
      date: "2026-09-14",
      weather: "",
      stops: [
        { name: "A museum", category: "entry", cost, time: "10:00 AM", durationLabel: "1 hour", note: "", lat: 0, lng: 0 },
      ],
    },
  ],
});

test("says nothing when the plan is inside the budget", () => {
  assert.deepEqual(evaluateBudget(itineraryCosting(300), 1000), []);
});

test("fires when the plan alone exceeds the budget", () => {
  const [finding] = evaluateBudget(itineraryCosting(1200), 1000);
  assert.equal(finding.rule, "budget");
  assert.equal(finding.dayIndex, null, "budget is trip-wide, not a per-day finding");
  assert.match(finding.message, /200 over your \$1000 budget/);
});

test("says nothing when there is no budget to compare against", () => {
  assert.deepEqual(evaluateBudget(itineraryCosting(500), 0), []);
});

/* --- The `realMinutes` seam ---
 *
 * `checkLegs` has always preferred a looked-up door-to-door duration over the haversine estimate,
 * and until `osrmRoute.ts` landed nothing anywhere passed one — so the branch shipped unexercised.
 * These two cover both of its directions, because the failure modes are opposite and both silent:
 * a lookup that is ignored leaves the plan validated against straight-line guesses, and a `null`
 * that skips the check instead of falling back drops the guardrail entirely for that leg. */

/** Two stops ten minutes apart on the clock and ~250m apart on the ground — a gap the estimate is
 *  comfortable with, so any finding here came from the injected lookup. */
const tightDay = {
  date: "2026-09-14",
  weather: "",
  stops: [
    { name: "Louvre", category: "entry", cost: 0, time: "10:00 AM", durationLabel: "1 hour", note: "", lat: 48.8606, lng: 2.3364 },
    { name: "Palais-Royal", category: "entry", cost: 0, time: "11:10 AM", durationLabel: "1 hour", note: "", lat: 48.8626, lng: 2.3376 },
  ],
};

test("a real duration overrides the estimate that would have passed", () => {
  assert.deepEqual(
    evaluateDay(tightDay, 0).filter((g) => g.rule === "travel"),
    [],
    "the estimate alone finds nothing here — otherwise the next assertion proves nothing"
  );

  const [finding] = evaluateDay(tightDay, 0, undefined, () => 45).filter((g) => g.rule === "travel");
  assert.equal(finding?.rule, "travel", "a measured 45-minute walk into a 10-minute gap must fire");
  assert.match(finding.message, /takes about 45 min, but only 10 min is left/);
});

test("an unroutable pair falls back to the estimate rather than skipping the check", () => {
  assert.deepEqual(
    evaluateDay(tightDay, 0, undefined, () => null),
    evaluateDay(tightDay, 0),
    "null means 'we could not answer', not 'there is nothing to check' — dropping the leg would silently retire the guardrail for every leg OSRM cannot reach"
  );
});

/* --- §14e: the same place twice --- */

test("the same place on two days is a finding; the lodging is not", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      {
        date: "2026-09-19",
        weather: "Clear",
        lodging: { name: "Boutique hotel in Gion", cost: 180, note: "" },
        stops: [{ name: "Nishiki Market", lat: 35.0050, lng: 135.7649, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }],
      },
      {
        date: "2026-09-20",
        weather: "Clear",
        lodging: { name: "Boutique hotel in Gion", cost: 180, note: "" },
        stops: [{ name: "nishiki  market", lat: 35.0050, lng: 135.7649, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }],
      },
    ],
  };
  const found = evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate");
  assert.equal(found.length, 1, "one finding for the repeated market");
  assert.match(found[0].message, /Nishiki Market/);
  assert.equal(found[0].dayIndex, 1, "reported against the later day, which is the one to change");
});

test("two different places close together are not duplicates", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Museu Picasso", lat: 41.3851, lng: 2.1810, cost: 12, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Gothic Quarter", lat: 41.3833, lng: 2.1766, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }] },
    ],
  };
  assert.deepEqual(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate"), []);
});

test("two food stops sharing a neighborhood's coordinates are not duplicates", () => {
  // §3b: an area-level food stop carries the neighborhood's own lat/lng, so two different meals
  // in the same district are supposed to land on the same point.
  const itinerary = {
    tier: "mid-range",
    days: [
      {
        date: "2026-09-19",
        weather: "Clear",
        stops: [
          { name: "Lunch around Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 20, note: "", time: "12:00", durationLabel: "1 hour", category: "food" },
          { name: "Dinner around Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 40, note: "", time: "19:00", durationLabel: "1 hour", category: "food" },
        ],
      },
    ],
  };
  assert.deepEqual(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate"), []);
});

test("two transit legs sharing a station's coordinates are not duplicates", () => {
  // An arrival transfer to a station and a departure transfer from it are the same coordinate on
  // purpose — different legs, same point.
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Airport to Kyoto Station", lat: 34.9851, lng: 135.7583, cost: 60, note: "", time: "15:30", durationLabel: "1h 45m", category: "transit" }] },
      { date: "2026-09-21", weather: "Clear", stops: [{ name: "Transfer to Kyoto Station", lat: 34.9851, lng: 135.7583, cost: 15, note: "", time: "08:00", durationLabel: "20m", category: "transit" }] },
    ],
  };
  assert.deepEqual(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate"), []);
});

test("two food stops with the same name are still a duplicate — name matching survives", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Dinner at Sushi Dai", lat: 35.6654, lng: 139.7707, cost: 50, note: "", time: "19:00", durationLabel: "1 hour", category: "food" }] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Dinner at Sushi Dai", lat: 35.6700, lng: 139.7800, cost: 50, note: "", time: "19:00", durationLabel: "1 hour", category: "food" }] },
    ],
  };
  assert.equal(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate").length, 1);
});

test("two non-food, non-transit stops still trip on proximity — the narrowing doesn't swallow this", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Sensō-ji", lat: 35.7148, lng: 139.7967, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Asakusa Kannon Temple", lat: 35.7148, lng: 139.7967, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }] },
    ],
  };
  assert.equal(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate").length, 1);
});

test("a food stop at the same point as a prior sight is not a duplicate", () => {
  // The mixed pair the same-category tests cannot reach: the exemption has to hold on the
  // CURRENT stop as well as the prior one. "Pike Place Market" is `other`, and a meal there the
  // next day is `food` carrying the market's own coordinates per §3b — two different things at
  // one point, and the prior-side filter alone would not spare them.
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" }] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Lunch at Pike Place", lat: 47.6097, lng: -122.3422, cost: 25, note: "", time: "12:00", durationLabel: "1 hour", category: "food" }] },
    ],
  };
  assert.deepEqual(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate"), []);
});

test("two unlocated stops are not the same place just because both sit at 0,0", () => {
  // `STOP_SHAPE` literally ships `"lat":0.0,"lng":0.0`, so a model copying the template lands
  // every unlocated stop on Null Island, and `normalizeDays` passes 0 through. Mirrors
  // `scoreDuplicates`, which falls back to name matching when a coordinate is missing.
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Teamlab Planets", lat: 0, lng: 0, cost: 30, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Shibuya Sky", lat: 0, lng: 0, cost: 20, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }] },
    ],
  };
  assert.deepEqual(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate"), []);
});

test("the same stop twice within one day is also a duplicate", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      {
        date: "2026-09-19",
        weather: "Clear",
        stops: [
          { name: "Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 0, note: "", time: "10:00", durationLabel: "1 hour", category: "other" },
          { name: "Pike Place Market", lat: 47.6097, lng: -122.3422, cost: 0, note: "", time: "15:00", durationLabel: "1 hour", category: "other" },
        ],
      },
    ],
  };
  assert.equal(evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate").length, 1);
});

/* --- §0 rank 1: what the traveler already committed to --- */

const LOGISTICS = {
  arrivalTime: "13:45",
  arrivalPoint: "KIX",
  departureTime: "18:00",
  departurePoint: "KIX",
  stayBooked: "Hotel Ronda (already paid)",
};

const twoDayTrip = (firstStopTime, lastStopTime) => ({
  tier: "mid-range",
  days: [
    {
      date: "2026-09-19",
      weather: "Clear",
      lodging: { name: "Hotel Ronda (already paid)", cost: 0, note: "" },
      stops: [{ name: "Gion walk", lat: 35.0037, lng: 135.7788, cost: 0, note: "", time: firstStopTime, durationLabel: "1 hour", category: "other" }],
    },
    {
      date: "2026-09-20",
      weather: "Clear",
      stops: [{ name: "Nishiki Market", lat: 35.0050, lng: 135.7649, cost: 0, note: "", time: lastStopTime, durationLabel: "1 hour", category: "other" }],
    },
  ],
});

test("a stop before the arrival buffer clears is a commitment finding", () => {
  // Lands 13:45, so nothing may start before 15:15.
  const found = evaluateItinerary(twoDayTrip("14:00", "09:00"), { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /arriv/i);
  assert.equal(found[0].dayIndex, 0);
});

test("the arrival buffer is 90 minutes, not some shorter number", () => {
  // The existing arrival test uses a 15-minute violation, which fires against any buffer at all.
  // 15:00 is the discriminating case: it clears a 60-minute buffer (14:45) and violates the
  // 90-minute one (15:15). ARRIVAL_BUFFER_MIN is mirrored by contract in SKILL.md §4c-bis, in
  // formatTravelLegs's prompt text and in the benchmark scorer — move one, move all three, and
  // this is what notices when only the constant moves.
  const found = evaluateItinerary(twoDayTrip("15:00", "09:00"), { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1, "lands 13:45, so 15:00 is still inside the 90-minute buffer");
  assert.match(found[0].message, /90 min/);
});

test("a stop running into the departure buffer is a commitment finding", () => {
  // Departs 18:00, so nothing may still be running after 16:00.
  const found = evaluateItinerary(twoDayTrip("15:30", "15:30"), { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /depart/i);
  assert.equal(found[0].dayIndex, 1);
});

test("booked lodging charged again is a commitment finding", () => {
  const trip = twoDayTrip("15:30", "09:00");
  trip.days[0].lodging = { name: "Hotel Ronda (already paid)", cost: 180, note: "" };
  const found = evaluateItinerary(trip, { logistics: LOGISTICS })
    .filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /already paid/i);
});

test("only the booked stay is flagged, not every other city's hotel", () => {
  // The regression this guards: `stayBooked` names ONE stay, and the check used to fire on any
  // priced lodging whenever it was non-null. On a multi-city trip that reported every other
  // city's correctly-priced hotel as already paid for — and Task 10 hands these findings to a
  // critique model as fact, which would then zero out a real cost.
  const trip = {
    tier: "mid-range",
    days: [
      {
        date: "2026-09-19",
        weather: "Clear",
        lodging: { name: "Hotel Ronda Sant Pere", cost: 190, note: "" },
        stops: [{ name: "Sagrada Familia", lat: 41.4036, lng: 2.1744, cost: 26, note: "", time: "10:00", durationLabel: "2 hours", category: "entry" }],
      },
      {
        date: "2026-09-20",
        weather: "Clear",
        lodging: { name: "Pension Aran", cost: 120, note: "" },
        stops: [{ name: "Alhambra", lat: 37.1761, lng: -3.5881, cost: 19, note: "", time: "10:00", durationLabel: "2 hours", category: "entry" }],
      },
    ],
  };
  // Only the stay is booked here — no flights, so the arrival and departure branches stay quiet
  // and anything this finds came from the lodging comparison.
  const found = evaluateItinerary(trip, {
    logistics: {
      arrivalTime: null,
      arrivalPoint: null,
      departureTime: null,
      departurePoint: null,
      stayBooked: "Hotel Ronda Sant Pere (already paid)",
    },
  }).filter((g) => g.rule === "commitment");
  assert.equal(found.length, 1, "the second city's hotel is correctly priced and must stay silent");
  assert.equal(found[0].dayIndex, 0);
  assert.match(found[0].message, /Hotel Ronda Sant Pere/);
});

test("no logistics means no commitment findings at all", () => {
  assert.deepEqual(
    evaluateItinerary(twoDayTrip("06:00", "23:00")).filter((g) => g.rule === "commitment"),
    []
  );
});

/* --- §0 rank 4: what the traveler named outright --- */

const oneStop = (name) => ({
  tier: "mid-range",
  days: [
    {
      date: "2026-09-19",
      weather: "Clear",
      stops: [{ name, lat: 48.8606, lng: 2.3376, cost: 20, note: "", time: "10:00", durationLabel: "1 hour", category: "entry" }],
    },
  ],
});

test("a must-include that never appears is a finding", () => {
  const found = evaluateItinerary(oneStop("Musée d'Orsay"), { mustInclude: ["Louvre Museum"] })
    .filter((g) => g.rule === "required");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Louvre Museum/);
  assert.equal(found[0].dayIndex, null, "a missing must-do is a trip-wide finding");
});

test("a must-include that appears is not a finding", () => {
  assert.deepEqual(
    evaluateItinerary(oneStop("Louvre Museum"), { mustInclude: ["louvre  museum"] })
      .filter((g) => g.rule === "required"),
    []
  );
});

test("a must-include matches as a substring, so a prefix of the real name counts", () => {
  assert.deepEqual(
    evaluateItinerary(oneStop("Louvre Museum"), { mustInclude: ["Louvre"] })
      .filter((g) => g.rule === "required"),
    [],
    "travelers name the place, not its full signage"
  );
});

test("an excluded term that appears is a finding", () => {
  const found = evaluateItinerary(oneStop("Rooftop cocktail bar"), { avoid: ["bar"] })
    .filter((g) => g.rule === "required");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /bar/i);
});

test("an exclusion matches whole words only, so 'bar' does not fire on Barcelona", () => {
  // The asymmetry with must-include is deliberate: a must-do is typically a prefix of a longer
  // real name, an exclusion is a whole word. A check that cries wolf on every Barcelona stop
  // trains everyone to ignore the channel this feeds.
  assert.deepEqual(
    evaluateItinerary(oneStop("Barcelona Cathedral"), { avoid: ["bar"] })
      .filter((g) => g.rule === "required"),
    []
  );
});

test("no must-include and no exclusions means no required findings at all", () => {
  // The gate, matching the one `commitment` has: an absent option means "not asked", never
  // "nothing was named", so the check must not run at all.
  //
  // **This one cannot be made to discriminate, and that is a property of the gate rather than of
  // the test.** `commitment`'s gate is load-bearing — dropping it would read absent times as a
  // boundary of midnight. This gate is a short-circuit over two empty arrays, and
  // `checkRequired(itinerary, [], [])` returns `[]` by construction, so deleting it changes no
  // output for any fixture. The assert states the contract; nothing can state more than that.
  assert.deepEqual(
    evaluateItinerary(oneStop("Musee d'Orsay")).filter((g) => g.rule === "required"),
    []
  );
});
