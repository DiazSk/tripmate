import test from "node:test";
import assert from "node:assert/strict";

import { EVIDENCE_LABEL, locationNote, stopEvidence } from "./evidence.ts";

const stop = (over = {}) => ({
  name: "Jerónimos Monastery",
  lat: 38.6979,
  lng: -9.2065,
  cost: 12,
  note: "Manueline cloisters, go early",
  time: "10:30 AM",
  durationLabel: "1.5 hours",
  category: "entry",
  ...over,
});

const kinds = (facts) => Object.fromEntries(facts.map((f) => [f.label, f.evidence]));

test("every member of the vocabulary has a label a reader could act on", () => {
  for (const k of ["sourced", "computed", "live", "entered", "planner"]) {
    assert.ok(EVIDENCE_LABEL[k], `no label for ${k}`);
  }
});

/**
 * Absence is a third state. Every itinerary already on disk has no `located`, and saying
 * "estimated" there would assert that a check failed when none ran — the error `planHealth`
 * avoids by printing "Not checked" rather than 100.
 */
test("a plan that predates the field says nothing about location", () => {
  assert.equal(locationNote(undefined), null);
  assert.ok(!stopEvidence(stop()).some((f) => f.label === "Location"));
});

test("a matched stop cites the listing; a missed one says whose estimate it is", () => {
  assert.equal(locationNote("osm").evidence, "sourced");
  assert.match(locationNote("osm").value, /OpenStreetMap/);
  assert.equal(locationNote("model").evidence, "planner");
  assert.match(locationNote("model").value, /estimate/);
  assert.equal(locationNote("search").evidence, "sourced");
});

/**
 * The conflation this module exists for: `addPlaceToDay` fills `note` from `describePlace`,
 * which composes OSM's own tags. The same field on a generated stop is prose the model wrote.
 */
test("the note's footing depends on where the stop came from", () => {
  assert.equal(kinds(stopEvidence(stop({ located: "search" })))["Detail"], "sourced");
  assert.equal(kinds(stopEvidence(stop({ located: "osm" })))["Detail"], "planner");
  assert.equal(kinds(stopEvidence(stop({ located: "model" })))["Detail"], "planner");
});

test("why is always the planner's, whatever the location turned out to be", () => {
  const facts = kinds(stopEvidence(stop({ located: "search", why: "Fits an easy-paced day" })));
  assert.equal(facts["Why here"], "planner");
});

test("travel is calculated, and is not recomputed here", () => {
  const facts = stopEvidence(stop(), { travelMinutes: 27, travelMode: "tram", leaveBy: "10:03 AM" });
  const k = kinds(facts);
  assert.equal(k["Getting here"], "computed");
  assert.equal(k["Leave by"], "computed");
  assert.match(facts.find((f) => f.label === "Getting here").value, /27 min by tram/);
  // Nothing to say rather than a zero, when the caller has no leg for it.
  assert.ok(!kinds(stopEvidence(stop()))["Getting here"]);
});

test("a corrected price is the traveller's; an uncorrected one is the planner's", () => {
  assert.equal(kinds(stopEvidence(stop()))["Cost"], "planner");
  assert.equal(kinds(stopEvidence(stop({ actualCost: 14 })))["Cost"], "entered");
  // A free stop states no price at all rather than asserting zero.
  assert.ok(!kinds(stopEvidence(stop({ cost: 0 })))["Cost"]);
});

test("booked is the traveller's commitment, never the planner's judgement", () => {
  assert.ok(!kinds(stopEvidence(stop()))["Booked"]);
  assert.equal(kinds(stopEvidence(stop({ timeFlexibility: "FIXED" })))["Booked"], "entered");
});

// `live` is the one category with no stop-level member today — weather belongs to a day. It
// stays in the vocabulary because that is where an opening-state lookup would land, and this
// asserts nothing has been invented to fill it.
test("nothing on a stop claims to be live", () => {
  const every = stopEvidence(stop({ located: "osm", why: "w", actualCost: 3, timeFlexibility: "FIXED" }), {
    travelMinutes: 5,
    travelMode: "walk",
    leaveBy: "9:00 AM",
  });
  assert.ok(!every.some((f) => f.evidence === "live"));
  assert.deepEqual(
    [...new Set(every.map((f) => f.evidence))].sort(),
    ["computed", "entered", "planner", "sourced"]
  );
});

test("an imported stop's own note is the traveller's, and a note TripMate wrote is the planner's", () => {
  // On an imported plan `note` is the traveller's own words unless the fill supplied it, which
  // `estimated` records. Captioning their words "the planner's" would invert the whole promise.
  const base = { name: "Torre de Belém", lat: 38.69, lng: -9.21, cost: 0, time: "10:00 AM", durationLabel: "1.5 h", category: "entry", located: "osm" };
  const detail = (stop) => stopEvidence(stop).find((f) => f.label === "Detail")?.evidence;
  assert.equal(detail({ ...base, note: "Go early", estimated: ["duration"] }), "entered");
  assert.equal(detail({ ...base, note: "Best at opening.", estimated: ["duration", "note"] }), "planner");
  assert.equal(detail({ ...base, note: "Planner prose." }), "planner");
});
