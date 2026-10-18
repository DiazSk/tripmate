/* Run: node --test src/lib/itineraryPatch.test.mjs
 *
 * The applier had no tests of its own, and every case below is one where being wrong is INVISIBLE:
 * the ops are all in range, so nothing is rejected, the reply says the change was made, and the
 * traveller only finds out by re-reading a plan they had no reason to re-read. That is the whole
 * risk surface of a chat turn that asks for more than one thing at once. */
import assert from "node:assert/strict";
import test from "node:test";
import { applyPatch } from "./itineraryPatch.ts";

const stop = (name) => ({
  name,
  lat: 35,
  lng: 135,
  cost: 10,
  note: "",
  time: "9:00 AM",
  durationLabel: "1 hour",
  category: "entry",
});

/** Day 1 is the one every multi-op test works on; day 2 is there to catch an op that escapes it. */
const trip = () => ({
  tier: "midrange",
  days: [
    { date: "2026-09-19", weather: "", stops: ["A", "B", "C", "D"].map(stop) },
    { date: "2026-09-20", weather: "", stops: [stop("E")] },
  ],
});

const names = (itinerary, dayIndex) => itinerary.days[dayIndex].stops.map((s) => s.name);

// THE bug this file exists for. Both indices are in range at the moment each op ran, so the old
// applier removed B and then whatever had slid into slot 2 — D, not C — and said nothing.
test("two removals on one day take the two stops named, listed lowest index first", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
    { op: "remove_stop", dayIndex: 0, stopIndex: 2 },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(names(itinerary, 0), ["A", "D"]);
});

test("the same two removals listed highest index first land identically", () => {
  const { itinerary } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 2 },
    { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
  ]);
  assert.deepEqual(names(itinerary, 0), ["A", "D"]);
});

// "Drop the shrine and put ramen where it was" — the swap the model expresses as two ops.
test("removing a stop and adding one at the same index swaps it in place", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
    { op: "add_stop", dayIndex: 0, stopIndex: 1, stop: stop("Ramen") },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(names(itinerary, 0), ["A", "Ramen", "C", "D"]);
});

test("an add and a later remove on one day are independent of their order", () => {
  const ops = [
    { op: "add_stop", dayIndex: 0, stopIndex: 0, stop: stop("Coffee") },
    { op: "remove_stop", dayIndex: 0, stopIndex: 3 },
  ];
  assert.deepEqual(names(applyPatch(trip(), ops).itinerary, 0), ["Coffee", "A", "B", "C"]);
  assert.deepEqual(names(applyPatch(trip(), ops.toReversed()).itinerary, 0), [
    "Coffee",
    "A",
    "B",
    "C",
  ]);
});

// A retime alongside a removal: the old applier merged the new fields into whichever stop had
// shifted into slot 3, so the traveller got D's row wearing C's clock time.
test("a replace after a removal still finds the stop it named", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 0 },
    { op: "replace_stop", dayIndex: 0, stopIndex: 3, stop: { ...stop("D"), time: "6:00 PM" } },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(names(itinerary, 0), ["B", "C", "D"]);
  assert.equal(itinerary.days[0].stops[2].time, "6:00 PM");
  assert.equal(itinerary.days[0].stops[1].time, "9:00 AM", "C keeps its own time");
});

test("a replace keeps fields the model left out", () => {
  const { itinerary } = applyPatch(trip(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: { name: "A2" } },
  ]);
  assert.equal(itinerary.days[0].stops[0].name, "A2");
  assert.equal(itinerary.days[0].stops[0].lat, 35, "coordinates survive a partial replace");
});

// A reorder is one replace per position, indices unchanged — it must not be read as a swap of
// identities and then re-resolved against itself.
test("a reorder written as two replaces exchanges the two stops", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: stop("B") },
    { op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: stop("A") },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(names(itinerary, 0), ["B", "A", "C", "D"]);
});

test("a move across days is a remove and an add, and neither disturbs the other", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 2 },
    { op: "add_stop", dayIndex: 1, stopIndex: 0, stop: stop("C") },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(names(itinerary, 0), ["A", "B", "D"]);
  assert.deepEqual(names(itinerary, 1), ["C", "E"]);
});

// Silence here is what the whole change is against: the second op must not quietly act on C.
test("a stop removed twice is rejected by name rather than taking its neighbour", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
    { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
  ]);
  assert.deepEqual(names(itinerary, 0), ["A", "C", "D"]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /had already been removed/);
});

test("an index past the end of the day is still out of range", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 9 },
  ]);
  assert.deepEqual(names(itinerary, 0), ["A", "B", "C", "D"]);
  assert.match(rejected[0].reason, /day 1 has no stop 10/);
});

// A model can send an op with no usable index. The reason reaches the traveller, so it must not read
// "day NaN" (copy rows T-54a, T-56a, T-57a).
test("a missing or non-integer index is worded without a number", () => {
  const ops = [
    { op: "remove_day" },
    { op: "add_day", dayIndex: 1.5 },
    { op: "remove_stop", stopIndex: 0 },
    { op: "replace_stop", dayIndex: 0, stop: stop("X") },
    { op: "remove_stop", dayIndex: 0, stopIndex: "1" },
  ];
  const { rejected } = applyPatch(trip(), ops);
  assert.equal(rejected.length, ops.length);
  for (const r of rejected) assert.doesNotMatch(r.reason, /NaN|undefined|null/, r.reason);
  assert.match(rejected[0].reason, /didn’t name a day/);
  assert.match(rejected[4].reason, /didn’t name a stop on day 1/);
});

// An add is the one op with no stop to name, so a too-large index appends rather than rejecting —
// it is how the model asks for the end of the day.
test("adding past the end appends", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "add_stop", dayIndex: 0, stopIndex: 9, stop: stop("Nightcap") },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(names(itinerary, 0), ["A", "B", "C", "D", "Nightcap"]);
});

// The snapshot is keyed by the day object, so the empty day added here must not inherit day 1's.
test("a day added and filled in the same patch keeps its own indices", () => {
  const { itinerary, rejected } = applyPatch(trip(), [
    { op: "add_day", dayIndex: 2 },
    { op: "add_stop", dayIndex: 2, stopIndex: 0, stop: stop("New") },
    { op: "remove_stop", dayIndex: 0, stopIndex: 0 },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(itinerary.days.length, 3);
  assert.deepEqual(names(itinerary, 2), ["New"]);
  assert.deepEqual(names(itinerary, 0), ["B", "C", "D"]);
  assert.equal(itinerary.days[2].date, "2026-09-21", "the new day takes the next calendar date");
});

test("a scope-locked element edit still refuses everything but its own slot", () => {
  const { itinerary, rejected } = applyPatch(
    trip(),
    [
      { op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: stop("A2") },
      { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
    ],
    { dayIndex: 0, stopIndex: 0 }
  );
  assert.deepEqual(names(itinerary, 0), ["A2", "B", "C", "D"]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /beyond the stop you’re editing/);
});

test("the itinerary handed in is never mutated", () => {
  const original = trip();
  applyPatch(original, [
    { op: "remove_stop", dayIndex: 0, stopIndex: 0 },
    { op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: { name: "B2" } },
  ]);
  assert.deepEqual(names(original, 0), ["A", "B", "C", "D"]);
});

/* §0 rank 1: a stop the traveler booked is one the plan is built around.
 *
 * These matter for the same reason as everything above — the model is *also* told not to move a
 * FIXED stop, so every case here is one where the only thing standing between a confident reply
 * and a lost reservation is the applier refusing. The protection is deliberately narrow: the
 * *when* and the *what*, not the whole object. */
const booked = (name) => ({ ...stop(name), time: "7:00 PM", timeFlexibility: "FIXED" });

const withBooking = () => ({
  tier: "midrange",
  days: [{ date: "2026-09-19", weather: "", stops: [stop("A"), booked("Dinner at Den")] }],
});

test("a booked stop cannot be dropped, and says why", () => {
  const { itinerary, rejected } = applyPatch(withBooking(), [
    { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /booked, so it stays/);
  assert.deepEqual(names(itinerary, 0), ["A", "Dinner at Den"], "the stop survives the refusal");
});

test("a booked stop's time cannot be moved", () => {
  const { itinerary, rejected } = applyPatch(withBooking(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: { time: "5:30 PM" } },
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /booked for 7:00 PM/);
  assert.equal(itinerary.days[0].stops[1].time, "7:00 PM");
});

test("a booked stop cannot be swapped for somewhere else", () => {
  const { itinerary, rejected } = applyPatch(withBooking(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: { name: "Dinner at Narisawa" } },
  ]);
  assert.equal(rejected.length, 1);
  assert.deepEqual(names(itinerary, 0), ["A", "Dinner at Den"]);
});

// The lock would not be a lock if the thing it constrains could clear it. Unlocking is the
// traveler's, through the whole-itinerary write, never a patch op.
test("a patch cannot unlock a booked stop", () => {
  const { itinerary, rejected } = applyPatch(withBooking(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: { timeFlexibility: "PREFERRED" } },
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /unlock it on the stop/);
  assert.equal(itinerary.days[0].stops[1].timeFlexibility, "FIXED");
});

// The narrowness is the point: re-pricing a booked dinner or rewriting its note is ordinary
// editing, and refusing that would make the lock an annoyance rather than a guarantee.
test("a booked stop still takes an edit that leaves its time and name alone", () => {
  const { itinerary, rejected } = applyPatch(withBooking(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 1, stop: { cost: 180, note: "Counter seats" } },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(itinerary.days[0].stops[1].cost, 180);
  assert.equal(itinerary.days[0].stops[1].note, "Counter seats");
});

test("an ordinary stop is moved and dropped exactly as before", () => {
  const { itinerary, rejected } = applyPatch(withBooking(), [
    { op: "replace_stop", dayIndex: 0, stopIndex: 0, stop: { time: "11:00 AM" } },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(itinerary.days[0].stops[0].time, "11:00 AM");
});

/* A scope the model is only ASKED to respect is not a scope. The chat prompt has always stated
 * one and marked other days read-only; nothing contradicted a model that ignored it. */
test("a day-scoped edit refuses ops that land on another day", () => {
  const { itinerary, rejected } = applyPatch(
    trip(),
    [
      { op: "remove_stop", dayIndex: 0, stopIndex: 1 },
      { op: "remove_stop", dayIndex: 1, stopIndex: 0 },
    ],
    { dayIndex: 0 }
  );
  assert.deepEqual(
    itinerary.days[0].stops.map((s) => s.name),
    ["A", "C", "D"]
  );
  // Day 2 is untouched, and the traveller is told why rather than left to notice.
  assert.deepEqual(
    itinerary.days[1].stops.map((s) => s.name),
    ["E"]
  );
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].op.dayIndex, 1);
  assert.match(rejected[0].reason, /only for day 1/);
});

test("a day-scoped edit allows every op shape within its own day", () => {
  const { itinerary, rejected } = applyPatch(
    trip(),
    [
      { op: "remove_stop", dayIndex: 0, stopIndex: 0 },
      { op: "add_stop", dayIndex: 0, stopIndex: 4, stop: stop("New") },
      { op: "replace_lodging", dayIndex: 0, lodging: { name: "Hotel", cost: 100, note: "" } },
    ],
    { dayIndex: 0 }
  );
  assert.deepEqual(rejected, []);
  assert.deepEqual(
    itinerary.days[0].stops.map((s) => s.name),
    ["B", "C", "D", "New"]
  );
  assert.equal(itinerary.days[0].lodging.name, "Hotel");
});

/* `add_day`/`remove_day` re-flow every later date, which is the opposite of "only this day
 * changes" — and they name a dayIndex, so an index check alone would wave them through. */
test("a day-scoped edit refuses whole-day ops even on its own day", () => {
  for (const op of ["add_day", "remove_day"]) {
    const { itinerary, rejected } = applyPatch(trip(), [{ op, dayIndex: 0 }], { dayIndex: 0 });
    assert.equal(itinerary.days.length, 2, `${op} changed the trip's length`);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason, /changed another day/);
  }
});

test("no scope still means the whole trip", () => {
  const { rejected } = applyPatch(trip(), [{ op: "remove_stop", dayIndex: 1, stopIndex: 0 }]);
  assert.deepEqual(rejected, []);
});
