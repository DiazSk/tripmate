/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/guardrails.test.mjs
 *
 * `evaluateBudget` and `BudgetBar` show the traveler the same sum from two different places, and
 * this file exists because they must not disagree — two surfaces contradicting each other about
 * whether a trip is over budget is precisely the drift the contract docblock in itinerary.ts was
 * written about. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorCoverage,
  evaluateAnchors,
  evaluateBudget,
  evaluateDay,
  evaluateItinerary,
  isClosedOn,
  revisionIsNoWorse,
  weekdayName,
} from "./guardrails.ts";

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

test("a repeat under the same name says which day the other one is on", () => {
  // The real shape from the Lisbon fixture: two distinct stops, identical names, different days.
  // The finding is correct; the sentence used to be "Dinner in Bairro Alto is already in the trip
  // as Dinner in Bairro Alto", which names the stop the reader is already looking at and locates
  // nothing.
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [] },
      { date: "2026-09-20", weather: "Clear", stops: [{ name: "Dinner in Bairro Alto", lat: 38.7138, lng: -9.1458, cost: 30, note: "", time: "19:00", durationLabel: "1 hour", category: "food" }] },
      { date: "2026-09-21", weather: "Clear", stops: [] },
      { date: "2026-09-22", weather: "Clear", stops: [{ name: "Dinner in Bairro Alto", lat: 38.7145, lng: -9.1470, cost: 30, note: "", time: "19:00", durationLabel: "1 hour", category: "food" }] },
    ],
  };
  const found = evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate");
  assert.equal(found.length, 1);
  assert.equal(found[0].dayIndex, 3, "reported against the later day, which is the one to change");
  assert.equal(
    found[0].message,
    "Dinner in Bairro Alto is already in the trip, on day 2: the same place twice.",
    "names the other day, and does not print the same name twice"
  );
});

test("a repeat under a different name says both the name and the day", () => {
  const itinerary = {
    tier: "mid-range",
    days: [
      { date: "2026-09-19", weather: "Clear", stops: [{ name: "Alfama neighborhood walk", lat: 38.7115, lng: -9.1301, cost: 0, note: "", time: "17:30", durationLabel: "1 hour", category: "other" }] },
      { date: "2026-09-20", weather: "Clear", stops: [] },
      { date: "2026-09-21", weather: "Clear", stops: [{ name: "Miradouro de Santa Luzia", lat: 38.7119, lng: -9.1310, cost: 0, note: "", time: "09:30", durationLabel: "1 hour", category: "other" }] },
    ],
  };
  const found = evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate");
  assert.equal(found.length, 1);
  assert.equal(
    found[0].message,
    "Miradouro de Santa Luzia is already in the trip as Alfama neighborhood walk, on day 1: the same place twice.",
    "the proximity branch located the other stop too"
  );
});

test("a repeat within one day does not name a day the finding already renders under", () => {
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
  const found = evaluateItinerary(itinerary).filter((g) => g.rule === "duplicate");
  assert.equal(found.length, 1);
  assert.equal(
    found[0].message,
    "Pike Place Market is already in the trip: the same place twice.",
    "no ' as' clause and no day, because both would repeat what the reader has"
  );
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

/* --- Anchor coverage: which of the traveler's places made it in --- */

const stop = (name, lat = 0, lng = 0) => ({
  name, lat, lng, cost: 0, note: "", time: "9:00 AM", durationLabel: "1 hour", category: "other",
});
const planWith = (stopsByDay, anchors, unplaced = []) => ({
  tier: "midrange",
  days: stopsByDay.map((stops, i) => ({ date: `2026-10-0${i + 1}`, weather: "", stops })),
  anchors,
  unplaced,
});

test("anchorCoverage is null for a plan with no anchors", () => {
  assert.equal(anchorCoverage({ tier: "midrange", days: [] }), null);
});

test("a must counts as placed by a wrapping stop name, on the right day", () => {
  const cov = anchorCoverage(planWith(
    [[stop("Breakfast nearby")], [stop("Morning at teamLab Planets")]],
    [{ name: "teamLab Planets", lat: null, lng: null, priority: "must" }]
  ));
  assert.deepEqual(cov.placed, [{ name: "teamLab Planets", dayIndex: 1 }]);
  assert.deepEqual(cov.missing, []);
});

test("a must counts as placed within 150m even under another name", () => {
  const cov = anchorCoverage(planWith(
    [[stop("Senso-ji Temple", 35.7148, 139.7967)]],
    [{ name: "浅草寺", lat: 35.7149, lng: 139.7966, priority: "must" }]
  ));
  assert.equal(cov.placed.length, 1);
});

test("an explained must is unplaced; an unexplained one is missing and warned", () => {
  const plan = planWith(
    [[stop("Somewhere else", 10, 10)]],
    [
      { name: "Kawagoe", lat: 35.9, lng: 139.5, priority: "must" },
      { name: "Ghibli Museum", lat: 35.69, lng: 139.57, priority: "must" },
      { name: "Yanaka Ginza", lat: null, lng: null, priority: "want" },
    ],
    [{ name: "Kawagoe", reason: "70 min each way" }]
  );
  const cov = anchorCoverage(plan);
  assert.equal(cov.total, 2);
  assert.deepEqual(cov.unplaced, [{ name: "Kawagoe", reason: "70 min each way" }]);
  assert.deepEqual(cov.missing, ["Ghibli Museum"]);
  const warnings = evaluateAnchors(plan);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].rule, "anchors");
  assert.match(warnings[0].message, /Ghibli Museum/);
});

/* A leg that cannot reach a stop the traveler BOOKED is the same subtraction as a tight
 * connection, and a different fact about the trip. These assert the reclassification rather than
 * a second check: one problem, one finding, reported at §0 rank 1 and worded so somebody knows
 * their table is gone. */
const legStop = (over) => ({
  name: "A",
  category: "entry",
  cost: 0,
  note: "",
  time: "10:00 AM",
  durationLabel: "1 hour",
  lat: 35,
  lng: 135,
  ...over,
});

/** Two stops ~45km apart with five minutes between them — unreachable by any mode, so the
 *  assertion never depends on the tuned speeds in travelTime.ts. */
const unreachable = (toOver) => ({
  date: "2026-09-14",
  weather: "",
  stops: [legStop({}), legStop({ name: "Dinner at Den", time: "11:05 AM", lng: 135.5, ...toOver })],
});

test("an unreachable leg to an ordinary stop is a travel finding", () => {
  const [finding, ...rest] = evaluateDay(unreachable({}), 0);
  assert.deepEqual(rest, [], "one leg, one finding");
  assert.equal(finding.rule, "travel");
});

test("the same leg to a booked stop is a commitment, and names the arrival", () => {
  const [finding, ...rest] = evaluateDay(unreachable({ timeFlexibility: "FIXED" }), 0);
  assert.deepEqual(rest, [], "reclassified, never reported twice");
  assert.equal(finding.rule, "commitment");
  assert.match(finding.message, /arrives about/);
  assert.match(finding.message, /booking at/);
});

test("an overlap onto a booked stop is a commitment too", () => {
  const day = {
    date: "2026-09-14",
    weather: "",
    stops: [
      legStop({ durationLabel: "3 hours" }),
      legStop({ name: "Dinner at Den", time: "12:00 PM", timeFlexibility: "FIXED" }),
    ],
  };
  const [finding] = evaluateDay(day, 0);
  assert.equal(finding.rule, "commitment");
  assert.match(finding.message, /past the 12:00 PM booking at Dinner at Den/);
});

test("a booked stop the day comfortably reaches says nothing", () => {
  const day = {
    date: "2026-09-14",
    weather: "",
    stops: [
      legStop({}),
      legStop({ name: "Dinner at Den", time: "7:00 PM", timeFlexibility: "FIXED" }),
    ],
  };
  assert.deepEqual(evaluateDay(day, 0), []);
});

/* `stopIndex` is what lets a client draw a conflict on the row that causes it rather than only in
 * a panel. It names the ARRIVING stop — the one whose plan is now wrong — and getting that
 * backwards would put every warning one row too high, which reads as plausible and is wrong. */
test("a leg finding names the arriving stop, not the one that overran", () => {
  const [finding] = evaluateDay(unreachable({}), 0);
  assert.equal(finding.stopIndex, 1);
});

test("a weather finding names the outdoor stop, counted in the day's own order", () => {
  const day = {
    date: "2026-09-14",
    weather: "",
    weatherDetail: { date: "2026-09-14", tempMaxC: 20, tempMinC: 12, historical: false, precipitationProbability: 90, humidity: null, weatherCode: null, sunrise: null, sunset: null },
    stops: [
      legStop({ name: "Indoors", outdoor: false }),
      legStop({ name: "Also indoors", time: "11:00 AM", outdoor: false }),
      legStop({ name: "A garden", time: "1:00 PM", outdoor: true }),
    ],
  };
  const weather = evaluateDay(day, 0).filter((g) => g.rule === "weather");
  assert.equal(weather.length, 1);
  assert.equal(weather[0].stopIndex, 2, "filtering before indexing is how this goes wrong");
});

test("a finding about the day itself carries no stop", () => {
  // Every stop under 30 minutes and none of them food, so nothing in the day counts as a sit-down
  // break — which is what `checkPace` requires before an over-long day is a finding at all.
  const packed = {
    date: "2026-09-14",
    weather: "",
    stops: [
      legStop({ name: "First", time: "8:00 AM", durationLabel: "15 minutes" }),
      legStop({ name: "Last", time: "7:00 PM", durationLabel: "15 minutes" }),
    ],
  };
  const [pace] = evaluateDay(packed, 0);
  assert.equal(pace.rule, "pace");
  assert.equal(pace.stopIndex, undefined);
});

/* Clocks are minutes since midnight, so a 1 AM airport transfer after a 6 PM dinner read as 60
 * against a 1140 end and was reported as "runs until 7:00 PM, past the 1:00 AM booking" — the
 * Mumbai day 5 a tester hit. The late stop is the next morning; a real evening overlap still is
 * one. Same coordinates on both stops, so travel time never decides either case. */
test("a booked stop after midnight follows the evening, it does not clash with it", () => {
  const night = (dinner, next) => ({
    date: "2026-11-27",
    weather: "",
    stops: [
      legStop({ name: "Light dinner at hotel", category: "food", time: "6:00 PM", ...dinner }),
      legStop({ name: "Private transfer to BOM airport", timeFlexibility: "FIXED", ...next }),
    ],
  });
  const legRules = (day) =>
    evaluateDay(day, 0).filter((g) => ["overlap", "commitment", "travel"].includes(g.rule));

  assert.deepEqual(legRules(night({ durationLabel: "1 hour" }, { time: "1:00 AM" })), []);

  const [clash, ...rest] = legRules(night({ durationLabel: "2 hours" }, { time: "7:00 PM" }));
  assert.deepEqual(rest, []);
  assert.equal(clash.rule, "commitment");
  assert.match(clash.message, /runs until 8:00 PM, past the 7:00 PM booking/);

  // And a day that is merely out of order (a morning stop listed after the afternoon) is still
  // an overlap, not a stop twenty hours later.
  const misordered = legRules(night({ time: "2:00 PM" }, { time: "10:00 AM", timeFlexibility: undefined }));
  assert.equal(misordered[0]?.rule, "overlap");
});

test("a 04:00 departure after a 1 AM transfer is that night's, not this morning's", () => {
  const trip = {
    tier: "mid-range",
    days: [
      {
        date: "2026-11-27",
        weather: "",
        stops: [
          legStop({ name: "Phoenix Marketcity", time: "2:30 PM", durationLabel: "2 hours" }),
          legStop({ name: "Light dinner at hotel", time: "6:00 PM" }),
          legStop({ name: "Private transfer to BOM airport", time: "1:00 AM", timeFlexibility: "FIXED" }),
        ],
      },
    ],
  };
  const commitments = (departureTime) =>
    evaluateItinerary(trip, { logistics: { departureTime } }).filter((g) => g.rule === "commitment");
  assert.deepEqual(commitments("04:00"), []);
  // A departure the evening still runs into is still flagged.
  assert.equal(commitments("19:00").length, 2);
});


/* The gate that stopped the review pass being taken at its word.
 *
 * It was: the critique returned a day set, that set replaced every day, and nobody checked. So a
 * model rewriting a whole week to fix one leg could break three others and ship silently — which
 * is why every saved trip in this app came out of its own review with 3 to 16 findings still in
 * it. These assert the three behaviours that matter: worse is refused, better is taken, and a tie
 * is taken, because the review fixes plenty this cannot count. */
const legDay = (stops) => ({ date: "2026-09-14", weather: "", stops });
const at = (name, over = {}) => ({
  name,
  category: "entry",
  cost: 0,
  note: "",
  time: "10:00 AM",
  durationLabel: "1 hour",
  lat: 35,
  lng: 135,
  ...over,
});

/** One unreachable leg: ~45km apart with five minutes between them. */
const broken = { days: [legDay([at("A"), at("B", { time: "11:05 AM", lng: 135.5 })])] };
/** The same two places, far enough apart in the clock to be reachable. */
const fixed = { days: [legDay([at("A"), at("B", { time: "3:00 PM", lng: 135.5 })])] };

test("a revision that repairs an impossible leg is accepted", () => {
  const v = revisionIsNoWorse(broken, fixed);
  assert.equal(v.ok, true);
  assert.deepEqual([v.blockingBefore, v.blockingAfter], [1, 0]);
});

test("a revision that makes a leg impossible is refused", () => {
  const v = revisionIsNoWorse(fixed, broken);
  assert.equal(v.ok, false);
  assert.deepEqual([v.blockingBefore, v.blockingAfter], [0, 1]);
});

/* The case that corrected this gate, taken from the first real generation it ran against.
 *
 * The review removed an impossible leg and shortened three 13-hour days to 11.5, then gave day 4
 * the dinner it was missing — which put day 4 over the pace threshold too. Total findings: 4
 * before, 4 after. Judged on totals that plainly-better plan scored level, and one more day
 * tipping over would have had it thrown away. Blocking went 1 to 0, which is the fact that
 * mattered. */
test("trading an advisory finding for a real repair is accepted", () => {
  const tiring = {
    days: [
      legDay([
        at("A", { time: "9:00 AM" }),
        at("B", { time: "3:00 PM", lng: 135.5, durationLabel: "8 hours" }),
      ]),
    ],
  };
  const v = revisionIsNoWorse(broken, tiring);
  assert.equal(v.blockingBefore, 1, "the original could not be walked");
  assert.equal(v.blockingAfter, 0, "the revision can be");
  assert.ok(v.totalAfter >= v.totalBefore, "and it costs an advisory finding to get there");
  assert.equal(v.ok, true, "which is a trade the review is allowed to make");
});

// The review fixes dietary fit, interest coverage and plain bad ideas — none of them countable
// here. Demanding a countable improvement would throw all of that away.
test("a revision that changes nothing countable is accepted", () => {
  const reworded = { days: [legDay([at("A", { note: "go early" }), at("B", { time: "3:00 PM", lng: 135.5 })])] };
  const v = revisionIsNoWorse(fixed, reworded);
  assert.equal(v.ok, true);
  assert.deepEqual([v.blockingBefore, v.blockingAfter], [0, 0]);
});

// Budget is stated to the critique separately, and `finalizeDays` pins admission costs on one
// side of this comparison before the other. Counting it here would reject revisions over a
// difference this gate did not measure fairly.
test("the budget rule is excluded from the comparison", () => {
  const pricey = { days: [legDay([at("A", { cost: 9000 }), at("B", { time: "3:00 PM", lng: 135.5 })])] };
  const v = revisionIsNoWorse(fixed, pricey, { budget: 10 });
  assert.equal(v.ok, true, "an over-budget revision is not refused by this gate");
  assert.equal(v.totalAfter, 0);
});

const importedStop = (over = {}) => ({
  name: "x",
  lat: 38.7,
  lng: -9.14,
  cost: 0,
  note: "",
  time: "10:00 AM",
  durationLabel: "60 min",
  category: "entry",
  ...over,
});

test("closed fires on the weekday the stop's date falls on, read in UTC", () => {
  // 2026-11-02 is a Monday everywhere, but a local-time parse west of Greenwich reads Sunday.
  const it = { days: [{ date: "2026-11-02", weather: "", stops: [importedStop({ name: "Belém Tower", closedDays: ["Mo"] })] }] };
  const found = evaluateItinerary(it, {}).filter((f) => f.rule === "closed");
  assert.deepEqual(found, [{ rule: "closed", dayIndex: 0, stopIndex: 0, message: "Belém Tower is closed on Mondays." }]);
  assert.equal(weekdayName("2026-11-02"), "Monday");
});

test("unknown hours are never closed", () => {
  for (const closedDays of [null, undefined, []]) {
    assert.equal(isClosedOn({ closedDays }, "2026-11-02"), false);
  }
  assert.equal(isClosedOn({ closedDays: ["Tu"] }, "2026-11-02"), false);
});

test("an empty day is a finding on an imported plan and nothing on a generated one", () => {
  const days = [{ date: "2026-11-02", weather: "", stops: [importedStop()] }, { date: "2026-11-03", weather: "", stops: [] }];
  const imported = evaluateItinerary({ origin: "imported", days }, {}).filter((f) => f.rule === "empty");
  assert.deepEqual(imported, [{ rule: "empty", dayIndex: 1, message: "Nothing is planned on day 2 yet." }]);
  assert.deepEqual(evaluateItinerary({ days }, {}).filter((f) => f.rule === "empty"), []);
});
