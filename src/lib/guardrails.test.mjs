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

test("no logistics means no commitment findings at all", () => {
  assert.deepEqual(
    evaluateItinerary(twoDayTrip("06:00", "23:00")).filter((g) => g.rule === "commitment"),
    []
  );
});
