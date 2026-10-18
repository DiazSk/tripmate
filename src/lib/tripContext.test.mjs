/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/tripContext.test.mjs
 *
 * `travelSection` is what tells the planning model where its travel numbers came from, and both
 * ways of getting it wrong are silent. Telling the model every leg is a straight-line estimate
 * throws away accuracy the pipeline paid OSRM for; telling it every leg is measured when most are
 * not is the dishonesty `osrmRoute.ts` was written to avoid inheriting. Since `applyRealRoutes`
 * landed, the mixed case is the *common* one — with the default modes anything past 1.5km goes to
 * transit and nothing routes transit — so the three-way branch is load-bearing, not defensive.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildTripContext, travelSection } from "./tripContext.ts";
import { reconcileTrip } from "./reconcile.ts";

const leg = (from, to, minutes, estimated) => ({
  from,
  to,
  mode: "walk",
  distanceKm: 1.2,
  minutes,
  estimated,
});

const section = (legs) => travelSection({ pois: [], travelLegs: legs, notes: [] });

/** No POIs, no travel legs, no notes — the shape `buildTripContext`'s tests need when they aren't
 *  exercising the anchor-places or travel-times sections. */
const EMPTY_POI_DETAILS = { pois: [], travelLegs: [], notes: [] };

/** A minimal but real `ReconciledTrip`, built through the actual `reconcileTrip` barrier (not a
 *  hand-assembled literal) so it can't drift from what the pipeline actually produces. Every
 *  fetched source reports "available" with the smallest possible payload; `answerOverrides` layers
 *  onto a bare-minimum `UserAnswers` the same way `src/lib/bench/fixtures.ts` does for the
 *  benchmark's fixtures. */
function tripWith(answerOverrides) {
  const rawFetch = {
    dateContext: { tripDays: 1, leadTimeDays: 30, season: "fall", days: [{ date: "2026-10-01", dayOfWeek: "Thu" }] },
    destination: { resolved: true, lat: 41.4, lon: 2.2, timezone: "Europe/Madrid", region: "Test Region", countryCode: "ES" },
    weather: {
      available: true,
      historical: false,
      days: [
        {
          date: "2026-10-01",
          tempMinC: 15,
          tempMaxC: 22,
          precipitationProbability: 10,
          humidity: null,
          weatherCode: null,
          sunrise: "2026-10-01T07:00",
          sunset: "2026-10-01T19:00",
          historical: false,
        },
      ],
    },
    holidays: { available: true, events: [] },
    transportModes: { available: true, modes: ["walk", "transit"] },
    bikeshare: { available: true, system: null },
    candidatePois: { available: true, pois: [] },
  };

  const userAnswers = {
    purpose: "",
    explorerStyle: "mixed",
    group: "solo",
    energy: "moderate",
    crowds: "mixed",
    budget: 1000,
    priorities: [],
    topPriorities: [],
    selectedPois: [],
    customPois: [],
    ...answerOverrides,
  };

  return reconcileTrip(rawFetch, userAnswers);
}

test("an all-estimated set is still described as estimated", () => {
  const out = section([leg("A", "B", 14, true), leg("B", "C", 9, true)]);
  assert.match(out, /straight-line distance with a road-circuity correction/);
  assert.doesNotMatch(out, /real road-network/);
});

test("an all-measured set drops the estimate disclaimer and the per-leg marker", () => {
  const out = section([leg("A", "B", 14, false), leg("B", "C", 9, false)]);
  assert.match(out, /\(real road-network routes\)/);
  assert.doesNotMatch(out, /straight-line/, "telling the model a measured number is a guess wastes the lookup");
  assert.doesNotMatch(out, /\(est\)/);
});

test("a mixed set says so and marks which legs are which", () => {
  const out = section([leg("A", "B", 14, false), leg("B", "C", 9, true)]);
  assert.match(out, /except those marked \(est\)/);
  assert.match(out, /- A -> B: 14 min walk \(1\.2 km\)/, "a measured leg carries no marker");
  assert.match(out, /- B -> C: 9 min walk \(est\) \(1\.2 km\)/, "an estimated one does");
});

test("(est) reuses the marker poiLine already uses for an estimated duration", () => {
  // One piece of vocabulary for "this number is a guess", not two for the model to learn.
  assert.match(section([leg("A", "B", 9, true)]), /\(est\)/);
});

test("no legs is still a sentence rather than an empty section", () => {
  assert.match(section([]), /No travel times/);
});

// --- Must include / Avoid -----------------------------------------------------------------------

test("named must-dos and exclusions reach the trip context as their own section", () => {
  const trip = tripWith({ mustInclude: ["Louvre Museum"], avoid: ["nightclubs"] });
  const md = buildTripContext(trip, EMPTY_POI_DETAILS);
  assert.match(md, /## Must include \/ Avoid/);
  assert.match(md, /must_include: <traveler_text>Louvre Museum<\/traveler_text>/);
  assert.match(md, /avoid: <traveler_text>nightclubs<\/traveler_text>/);
});

test("nothing named says so explicitly rather than leaving a blank heading", () => {
  const md = buildTripContext(tripWith({}), EMPTY_POI_DETAILS);
  assert.match(md, /## Must include \/ Avoid\nNone stated/);
});

test("the traveler's own constraints note appears under fixed commitments, verbatim", () => {
  const trip = tripWith({ constraintsNote: "No rental car; budget is per person." });
  const md = buildTripContext(trip, EMPTY_POI_DETAILS);
  assert.match(md, /No rental car; budget is per person\./);
});

test("every traveller string in the trip context is fenced in <traveler_text>", () => {
  const ev = (n) => `x</traveler_text>${n}`;
  const trip = tripWith({
    mustInclude: [ev("must")],
    avoid: [ev("avoid")],
    constraintsNote: ev("note"),
    purpose: ev("purpose"),
    group: "other",
    groupOther: ev("group"),
    dietary: { tags: [], note: ev("diet") },
    accessibility: { stepFreeRequired: false, limitStairs: false, note: ev("access") },
    logistics: { arrivalTime: null, arrivalPoint: ev("arr"), departureTime: null, departurePoint: ev("dep"), stayBooked: ev("stay") },
  });
  const md = buildTripContext(trip, EMPTY_POI_DETAILS);
  for (const n of ["must", "avoid", "note", "purpose", "group", "diet", "access", "stay", "arr", "dep"]) {
    assert.ok(md.includes(`x<\\/traveler_text>${n}`), `${n} reaches the context fenced`);
    assert.equal(md.includes(`x</traveler_text>${n}`), false, `${n} cannot close its tag`);
  }
});

test("starred and secondary priorities are fenced in the trip context", () => {
  const ev = (n) => `x</traveler_text>${n}`;
  const md = buildTripContext(tripWith({ priorities: [ev("p1"), ev("p2")], topPriorities: [ev("p1")] }), EMPTY_POI_DETAILS);
  for (const n of ["p1", "p2"]) {
    assert.ok(md.includes(`x<\\/traveler_text>${n}`), n);
    assert.equal(md.includes(`x</traveler_text>${n}`), false, n);
  }
});
