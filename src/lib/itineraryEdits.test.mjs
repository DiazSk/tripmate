import test from "node:test";
import assert from "node:assert/strict";
import { addDay, deleteStop, insertStop, newStop, updateStop } from "./itineraryEdits.ts";

const stop = (name, time = "") => ({
  name,
  lat: 1,
  lng: 2,
  cost: 0,
  note: "",
  time,
  durationLabel: "",
  category: "other",
});

const trip = (days) => ({ tier: "mid", days });

test("a new day is dated the morning after the last one", () => {
  const next = addDay(trip([{ date: "2026-09-19", weather: "", stops: [] }]));
  assert.equal(next.days.length, 2);
  assert.equal(next.days[1].date, "2026-09-20");
});

test("adding a day crosses a month boundary correctly", () => {
  assert.equal(addDay(trip([{ date: "2026-09-30", weather: "", stops: [] }])).days[1].date, "2026-10-01");
});

test("adding a day crosses a leap day correctly", () => {
  // 2028 is a leap year: the 28th is followed by the 29th, not by March.
  assert.equal(addDay(trip([{ date: "2028-02-28", weather: "", stops: [] }])).days[1].date, "2028-02-29");
});

test("the new date does not roll back a day west of Greenwich", () => {
  // The calendar-date trap in CLAUDE.md: `new Date("2026-09-19")` is UTC midnight, so reading it
  // back with local accessors returns the 18th anywhere behind UTC. This test runs in whatever
  // zone the machine is in, which is the point.
  const next = addDay(trip([{ date: "2026-01-01", weather: "", stops: [] }]));
  assert.equal(next.days[1].date, "2026-01-02");
});

test("adding a day to an empty itinerary falls back to a given today", () => {
  // There is no previous date to count from, and refusing would leave the button dead.
  assert.equal(addDay(trip([]), "2026-08-24").days[0].date, "2026-08-24");
});

test("a hand-added stop claims no cost and no duration it hasn't earned", () => {
  const s = newStop("Rossio", 38.71, -9.13);
  assert.equal(s.cost, 0);
  assert.equal(s.durationLabel, "");
  assert.equal(s.category, "other");
  assert.equal(s.why, undefined);
});

test("inserting a stop appends it and leaves the other days alone", () => {
  const before = trip([
    { date: "2026-09-19", weather: "", stops: [stop("A")] },
    { date: "2026-09-20", weather: "", stops: [stop("B")] },
  ]);
  const after = insertStop(before, 0, { name: "C", lat: 5, lng: 6 });
  assert.deepEqual(after.days[0].stops.map((s) => s.name), ["A", "C"]);
  assert.deepEqual(after.days[1].stops.map((s) => s.name), ["B"]);
});

test("every edit leaves the input untouched", () => {
  // The caller hands the result straight to React state, so a mutation here would edit state in
  // place and the re-render would silently no-op.
  const before = trip([{ date: "2026-09-19", weather: "", stops: [stop("A")] }]);
  const snapshot = JSON.stringify(before);
  insertStop(before, 0, { name: "C", lat: 5, lng: 6 });
  updateStop(before, 0, 0, { name: "renamed" });
  deleteStop(before, 0, 0);
  addDay(before);
  assert.equal(JSON.stringify(before), snapshot);
});

test("updating a stop patches only that stop", () => {
  const before = trip([{ date: "2026-09-19", weather: "", stops: [stop("A"), stop("B")] }]);
  const after = updateStop(before, 0, 1, { name: "B2", time: "14:00" });
  assert.equal(after.days[0].stops[0].name, "A");
  assert.equal(after.days[0].stops[1].name, "B2");
  assert.equal(after.days[0].stops[1].time, "14:00");
  // Untouched fields survive the patch.
  assert.equal(after.days[0].stops[1].lat, 1);
});

test("deleting the last stop leaves the day, not a renumbered trip", () => {
  // Removing the day with its last stop would silently shift every day after it — the map's
  // colours, the labels and the panel's tabs are all keyed on day index.
  const before = trip([
    { date: "2026-09-19", weather: "", stops: [stop("A")] },
    { date: "2026-09-20", weather: "", stops: [stop("B")] },
  ]);
  const after = deleteStop(before, 0, 0);
  assert.equal(after.days.length, 2);
  assert.deepEqual(after.days[0].stops, []);
  assert.equal(after.days[1].stops[0].name, "B");
});

test("edits against a day or stop that isn't there return the itinerary unchanged", () => {
  const before = trip([{ date: "2026-09-19", weather: "", stops: [stop("A")] }]);
  assert.equal(insertStop(before, 9, { name: "X", lat: 0, lng: 0 }), before);
  assert.equal(updateStop(before, 0, 9, { name: "X" }), before);
  assert.equal(deleteStop(before, 9, 0), before);
  assert.equal(deleteStop(before, 0, 9), before);
});

test("a malformed date is returned as-is rather than becoming Invalid Date", () => {
  const next = addDay(trip([{ date: "not-a-date", weather: "", stops: [] }]));
  assert.equal(next.days[1].date, "not-a-date");
});
